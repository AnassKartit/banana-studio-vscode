import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { Jimp } from 'jimp';
import { BananaImageEditorProvider } from './imageEditor';

let currentPanel: vscode.WebviewPanel | undefined;
let ai: GoogleGenAI | undefined;
let secretStorage: vscode.SecretStorage;
let globalState: vscode.Memento;

// Key for storing custom sensitive data prompt
const SENSITIVE_PROMPT_KEY = 'nanoBanana.sensitiveDataPrompt';

// Default prompt for sensitive data detection
const DEFAULT_SENSITIVE_PROMPT = `Scan this screenshot for PERSONAL/PRIVATE information that should be hidden before sharing publicly.

ONLY detect these specific items:
- Email addresses (actual emails like user@domain.com)
- Phone numbers (actual phone numbers)
- Social media usernames (@handles visible in chat/profile)
- Real people's names shown in chat messages, contacts, or profiles
- Home/work addresses
- Credit card or bank account numbers
- License plates
- Personal IDs, SSN, passport numbers
- URLs containing personal identifiers

DO NOT detect:
- Faces in movie/TV posters, advertisements, or thumbnails
- Celebrity names or public figures
- App icons or logos
- Generic UI elements
- Fictional character names

Return a JSON array where each detected item has:
- "type": category (email, phone, username, name, address, id, etc.)
- "box_2d": bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000
- "value": the actual text found

If nothing sensitive found, return [].`;

// Supported image extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

// Secret key for API key storage
const API_KEY_SECRET = 'nanoBanana.geminiApiKey';

interface QuickPrompt {
  label: string;
  prompt: string;
  category?: string;
}

interface BoundingBox {
  box_2d: number[];
  label: string;
  mask?: string;
}

interface DetectionResult {
  boxes: BoundingBox[];
  width: number;
  height: number;
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Banana Studio extension is now active!');

  // Initialize secret storage and global state
  secretStorage = context.secrets;
  globalState = context.globalState;

  // Initialize the Google GenAI client
  await initializeAI();

  // Register custom image editor with right-click context menu
  context.subscriptions.push(BananaImageEditorProvider.register(context));

  // Register all commands
  context.subscriptions.push(
    // Generation commands
    vscode.commands.registerCommand('nanoBanana.generateImage', () => generateImage(context)),
    vscode.commands.registerCommand('nanoBanana.editImage', () => editImageFromEditor(context)),
    vscode.commands.registerCommand('nanoBanana.generateImageInFolder', (uri: vscode.Uri) => generateImageInFolder(context, uri)),
    vscode.commands.registerCommand('nanoBanana.editImageFromExplorer', (uri: vscode.Uri) => editImageFromExplorer(context, uri)),
    vscode.commands.registerCommand('nanoBanana.composeImages', () => composeImages(context)),
    vscode.commands.registerCommand('nanoBanana.openPreview', (uri: vscode.Uri) => openImagePreview(context, uri)),

    // Settings commands
    vscode.commands.registerCommand('nanoBanana.selectModel', selectModel),
    vscode.commands.registerCommand('nanoBanana.selectUnderstandingModel', selectUnderstandingModel),
    vscode.commands.registerCommand('nanoBanana.setAspectRatio', setAspectRatio),
    vscode.commands.registerCommand('nanoBanana.setResolution', setResolution),
    vscode.commands.registerCommand('nanoBanana.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('nanoBanana.checkApiKey', checkApiKeyStatus),

    // Quick prompts
    vscode.commands.registerCommand('nanoBanana.quickEdit', (uri: vscode.Uri) => quickEdit(context, uri)),
    vscode.commands.registerCommand('nanoBanana.manageQuickPrompts', manageQuickPrompts),

    // Image understanding commands
    vscode.commands.registerCommand('nanoBanana.analyzeImage', (uri: vscode.Uri) => analyzeImage(context, uri)),
    vscode.commands.registerCommand('nanoBanana.describeImage', (uri: vscode.Uri) => describeImage(context, uri)),
    vscode.commands.registerCommand('nanoBanana.detectObjects', (uri: vscode.Uri) => detectObjects(context, uri)),
    vscode.commands.registerCommand('nanoBanana.segmentObjects', (uri: vscode.Uri) => segmentObjects(context, uri)),
    vscode.commands.registerCommand('nanoBanana.extractText', (uri: vscode.Uri) => extractText(context, uri)),
    vscode.commands.registerCommand('nanoBanana.askAboutImage', (uri: vscode.Uri) => askAboutImage(context, uri)),

    // Privacy commands
    vscode.commands.registerCommand('nanoBanana.detectSensitiveData', (uri: vscode.Uri) => detectSensitiveData(context, uri)),
    vscode.commands.registerCommand('nanoBanana.autoBlurSensitive', (uri: vscode.Uri) => autoBlurSensitive(context, uri)),
    vscode.commands.registerCommand('nanoBanana.improveDetection', () => improveDetectionPrompt(context)),
    vscode.commands.registerCommand('nanoBanana.resetDetectionPrompt', () => resetDetectionPrompt(context)),
    vscode.commands.registerCommand('nanoBanana.restoreBackup', (uri: vscode.Uri) => restoreFromBackup(uri))
  );

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('nanoBanana')) {
        await initializeAI();
      }
    })
  );
}

async function getApiKey(): Promise<string | undefined> {
  console.log('Nano Banana: Getting API key...');

  // First try secret storage
  try {
    const apiKey = await secretStorage.get(API_KEY_SECRET);
    console.log('Nano Banana: Secret storage result:', apiKey ? `Found (${apiKey.length} chars)` : 'Not found');
    if (apiKey) {
      return apiKey;
    }
  } catch (error) {
    console.error('Nano Banana: Failed to read from secret storage:', error);
  }

  // Fallback to environment variable
  const envKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  console.log('Nano Banana: Environment variable result:', envKey ? 'Found' : 'Not found');
  return envKey;
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your Google Gemini API Key',
    placeHolder: 'AIza...',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length < 10) {
        return 'Please enter a valid API key';
      }
      return null;
    }
  });

  if (apiKey) {
    console.log('Nano Banana: Saving API key to secret storage...');
    try {
      await secretStorage.store(API_KEY_SECRET, apiKey.trim());
      console.log('Nano Banana: API key saved successfully');

      // Verify it was saved
      const savedKey = await secretStorage.get(API_KEY_SECRET);
      console.log('Nano Banana: Verification - Key retrieved:', savedKey ? 'Yes' : 'No');
    } catch (error) {
      console.error('Nano Banana: Failed to save API key:', error);
      vscode.window.showErrorMessage('Failed to save API key to secure storage');
      return;
    }
    await initializeAI();
    vscode.window.showInformationMessage('API key saved securely. Nano Banana is ready!');
  }
}

async function initializeAI(): Promise<void> {
  console.log('Nano Banana: initializeAI() called');

  try {
    const apiKey = await getApiKey();
    console.log('Nano Banana: API key found:', apiKey ? `Yes (${apiKey.substring(0, 8)}...)` : 'No');

    if (!apiKey) {
      console.log('Nano Banana: No API key, showing prompt');
      const action = await vscode.window.showWarningMessage(
        'Nano Banana: No API key found. Please set your Gemini API key.',
        'Set API Key',
        'Later'
      );
      if (action === 'Set API Key') {
        vscode.commands.executeCommand('nanoBanana.setApiKey');
      }
      return;
    }

    console.log('Nano Banana: Creating GoogleGenAI instance...');
    ai = new GoogleGenAI({ apiKey });
    console.log('Nano Banana: AI instance created:', ai ? 'Yes' : 'No');

    vscode.window.showInformationMessage('Nano Banana AI ready!');
  } catch (error: any) {
    console.error('Nano Banana: Failed to initialize AI:', error);
    console.error('Nano Banana: Error stack:', error.stack);
    vscode.window.showErrorMessage(`Failed to initialize AI: ${error.message}`);
    ai = undefined;
  }
}

async function checkApiKeyStatus(): Promise<void> {
  const apiKey = await getApiKey();
  const aiStatus = ai ? `Yes (${typeof ai})` : 'No';

  if (apiKey) {
    const msg = `API Key: ${apiKey.substring(0, 8)}... (${apiKey.length} chars) | AI Ready: ${aiStatus}`;
    console.log('Nano Banana: Status check -', msg);
    vscode.window.showInformationMessage(msg);

    // Try to initialize if not ready
    if (!ai) {
      const action = await vscode.window.showWarningMessage(
        'API key found but AI not initialized. Try to initialize now?',
        'Initialize',
        'Cancel'
      );
      if (action === 'Initialize') {
        await initializeAI();
        vscode.window.showInformationMessage(`AI Ready: ${ai ? 'Yes' : 'No'}`);
      }
    }
  } else {
    vscode.window.showWarningMessage('No API key found. Use "Set API Key" to configure.');
  }
}

async function ensureAI(): Promise<boolean> {
  if (ai) return true;

  await initializeAI();

  if (!ai) {
    const action = await vscode.window.showErrorMessage(
      'AI not initialized. Please set your Gemini API key.',
      'Set API Key'
    );
    if (action === 'Set API Key') {
      vscode.commands.executeCommand('nanoBanana.setApiKey');
    }
    return false;
  }
  return true;
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('nanoBanana');
  return {
    model: config.get<string>('defaultModel', 'gemini-2.5-flash-image'),
    understandingModel: config.get<string>('understandingModel', 'gemini-3-flash-preview'),
    aspectRatio: config.get<string>('defaultAspectRatio', '1:1'),
    resolution: config.get<string>('defaultResolution', '1K'),
    enableGoogleSearch: config.get<boolean>('enableGoogleSearch', false),
    quickPrompts: config.get<QuickPrompt[]>('quickPrompts', []),
    sensitiveDataTypes: config.get<string[]>('sensitiveDataTypes', []),
    blurIntensity: config.get<number>('blurIntensity', 25)
  };
}

async function fetchAvailableModels(): Promise<Array<{name: string, displayName: string, description?: string, supportedActions?: string[]}>> {
  if (!ai) {
    return [];
  }

  try {
    const modelList: Array<{name: string, displayName: string, description?: string, supportedActions?: string[]}> = [];
    const models = await ai.models.list();
    let { page } = models;

    while (page.length > 0) {
      for (const model of page) {
        modelList.push({
          name: model.name || '',
          displayName: model.displayName || model.name || '',
          description: model.description,
          supportedActions: model.supportedActions
        });
      }
      page = models.hasNextPage() ? await models.nextPage() : [];
    }

    return modelList;
  } catch (error: any) {
    console.error('Failed to fetch models:', error);
    return [];
  }
}

async function selectModel(): Promise<string | undefined> {
  if (!await ensureAI()) return undefined;

  const config = getConfig();

  // Show loading
  const models = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Fetching available models...',
    cancellable: false
  }, async () => {
    const allModels = await fetchAvailableModels();
    // Filter for image generation models
    return allModels.filter(m =>
      m.supportedActions?.includes('generateContent') &&
      (m.name?.includes('image') || m.name?.includes('flash') || m.name?.includes('pro'))
    );
  });

  if (models.length === 0) {
    // Fallback to hardcoded list
    const fallbackModels = [
      { label: config.model === 'gemini-2.0-flash-exp-image-generation' ? '$(check) Gemini 2.0 Flash (Image)' : 'Gemini 2.0 Flash (Image)', description: 'Fast image generation', value: 'gemini-2.0-flash-exp-image-generation' },
      { label: config.model === 'gemini-2.0-flash' ? '$(check) Gemini 2.0 Flash' : 'Gemini 2.0 Flash', description: 'Fast and efficient', value: 'gemini-2.0-flash' }
    ];

    const selected = await vscode.window.showQuickPick(fallbackModels, {
      placeHolder: 'Select AI model (could not fetch models from API)',
      title: '🍌 Nano Banana - Select Model'
    });

    if (selected) {
      await vscode.workspace.getConfiguration('nanoBanana').update('defaultModel', selected.value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Model set to: ${selected.label.replace('$(check) ', '')}`);
      return selected.value;
    }
    return undefined;
  }

  const modelItems = models.map(m => ({
    label: config.model === m.name ? `$(check) ${m.displayName}` : m.displayName,
    description: m.name,
    detail: m.description?.substring(0, 100),
    value: m.name
  }));

  const selected = await vscode.window.showQuickPick(modelItems, {
    placeHolder: 'Select AI model for image generation',
    title: '🍌 Nano Banana - Select Model',
    matchOnDescription: true
  });

  if (selected) {
    await vscode.workspace.getConfiguration('nanoBanana').update('defaultModel', selected.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Model set to: ${selected.label.replace('$(check) ', '')}`);
    return selected.value;
  }
  return undefined;
}

async function selectUnderstandingModel(): Promise<string | undefined> {
  if (!await ensureAI()) return undefined;

  const config = getConfig();

  const models = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Fetching available models...',
    cancellable: false
  }, async () => {
    const allModels = await fetchAvailableModels();
    // Filter for understanding models (text/vision)
    return allModels.filter(m =>
      m.supportedActions?.includes('generateContent') &&
      !m.name?.includes('imagen') // Exclude pure image generation
    );
  });

  if (models.length === 0) {
    const fallbackModels = [
      { label: config.understandingModel === 'gemini-2.0-flash' ? '$(check) Gemini 2.0 Flash' : 'Gemini 2.0 Flash', description: 'Fast understanding', value: 'gemini-2.0-flash' },
      { label: config.understandingModel === 'gemini-1.5-pro' ? '$(check) Gemini 1.5 Pro' : 'Gemini 1.5 Pro', description: 'Advanced understanding', value: 'gemini-1.5-pro' }
    ];

    const selected = await vscode.window.showQuickPick(fallbackModels, {
      placeHolder: 'Select AI model for image understanding',
      title: '🍌 Nano Banana - Select Understanding Model'
    });

    if (selected) {
      await vscode.workspace.getConfiguration('nanoBanana').update('understandingModel', selected.value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Understanding model set to: ${selected.label.replace('$(check) ', '')}`);
      return selected.value;
    }
    return undefined;
  }

  const modelItems = models.map(m => ({
    label: config.understandingModel === m.name ? `$(check) ${m.displayName}` : m.displayName,
    description: m.name,
    detail: m.description?.substring(0, 100),
    value: m.name
  }));

  const selected = await vscode.window.showQuickPick(modelItems, {
    placeHolder: 'Select AI model for image understanding',
    title: '🍌 Nano Banana - Select Understanding Model',
    matchOnDescription: true
  });

  if (selected) {
    await vscode.workspace.getConfiguration('nanoBanana').update('understandingModel', selected.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Understanding model set to: ${selected.label.replace('$(check) ', '')}`);
    return selected.value;
  }
  return undefined;
}

interface GenerationOptions {
  model: string;
  aspectRatio: string;
  resolution: string;
}

async function pickModelBeforeAction(): Promise<GenerationOptions | undefined> {
  const config = getConfig();

  const models = [
    {
      label: config.model === 'gemini-2.5-flash-image' ? '$(check) Banana Flash' : 'Banana Flash',
      description: 'Fast and efficient',
      detail: 'gemini-2.5-flash-image - Best for quick generations',
      value: 'gemini-2.5-flash-image'
    },
    {
      label: config.model === 'gemini-3-pro-image-preview' ? '$(check) Banana Pro' : 'Banana Pro',
      description: 'Professional quality',
      detail: 'gemini-3-pro-image-preview - Supports aspect ratio, resolution, Google Search',
      value: 'gemini-3-pro-image-preview'
    }
  ];

  const selectedModel = await vscode.window.showQuickPick(models, {
    placeHolder: `Current: ${config.model === 'gemini-2.5-flash-image' ? 'Flash' : 'Pro'} - Select model`,
    title: '🍌 Banana Studio - Select AI Model',
    ignoreFocusOut: true
  });

  if (!selectedModel) return undefined;

  // Save the model choice for next time
  if (selectedModel.value !== config.model) {
    await vscode.workspace.getConfiguration('nanoBanana').update('defaultModel', selectedModel.value, vscode.ConfigurationTarget.Global);
  }

  let aspectRatio = config.aspectRatio;
  let resolution = config.resolution;

  // If Pro model, ask for aspect ratio and resolution
  if (selectedModel.value === 'gemini-3-pro-image-preview') {
    // Pick aspect ratio
    const aspectRatios = [
      { label: config.aspectRatio === '1:1' ? '$(check) 1:1' : '1:1', description: 'Square', value: '1:1' },
      { label: config.aspectRatio === '16:9' ? '$(check) 16:9' : '16:9', description: 'Widescreen', value: '16:9' },
      { label: config.aspectRatio === '9:16' ? '$(check) 9:16' : '9:16', description: 'Portrait/Mobile', value: '9:16' },
      { label: config.aspectRatio === '4:3' ? '$(check) 4:3' : '4:3', description: 'Standard', value: '4:3' },
      { label: config.aspectRatio === '3:4' ? '$(check) 3:4' : '3:4', description: 'Portrait Standard', value: '3:4' },
      { label: config.aspectRatio === '3:2' ? '$(check) 3:2' : '3:2', description: 'Classic Photo', value: '3:2' },
      { label: config.aspectRatio === '2:3' ? '$(check) 2:3' : '2:3', description: 'Portrait Photo', value: '2:3' },
      { label: config.aspectRatio === '21:9' ? '$(check) 21:9' : '21:9', description: 'Ultrawide', value: '21:9' }
    ];

    const selectedAspect = await vscode.window.showQuickPick(aspectRatios, {
      placeHolder: `Current: ${config.aspectRatio} - Select aspect ratio`,
      title: '🍌 Banana Studio - Aspect Ratio',
      ignoreFocusOut: true
    });

    if (!selectedAspect) return undefined;
    aspectRatio = selectedAspect.value;

    // Save aspect ratio choice
    if (aspectRatio !== config.aspectRatio) {
      await vscode.workspace.getConfiguration('nanoBanana').update('defaultAspectRatio', aspectRatio, vscode.ConfigurationTarget.Global);
    }

    // Pick resolution
    const resolutions = [
      { label: config.resolution === '1K' ? '$(check) 1K' : '1K', description: 'Standard (1024px)', value: '1K' },
      { label: config.resolution === '2K' ? '$(check) 2K' : '2K', description: 'High Definition (2048px)', value: '2K' },
      { label: config.resolution === '4K' ? '$(check) 4K' : '4K', description: 'Ultra HD (4096px)', value: '4K' }
    ];

    const selectedRes = await vscode.window.showQuickPick(resolutions, {
      placeHolder: `Current: ${config.resolution} - Select resolution`,
      title: '🍌 Banana Studio - Resolution',
      ignoreFocusOut: true
    });

    if (!selectedRes) return undefined;
    resolution = selectedRes.value;

    // Save resolution choice
    if (resolution !== config.resolution) {
      await vscode.workspace.getConfiguration('nanoBanana').update('defaultResolution', resolution, vscode.ConfigurationTarget.Global);
    }
  }

  return {
    model: selectedModel.value,
    aspectRatio,
    resolution
  };
}

async function setAspectRatio() {
  const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  const selected = await vscode.window.showQuickPick(ratios, {
    placeHolder: 'Select aspect ratio for generated images'
  });

  if (selected) {
    await vscode.workspace.getConfiguration('nanoBanana').update('defaultAspectRatio', selected, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Aspect ratio set to: ${selected}`);
  }
}

async function setResolution() {
  const resolutions = [
    { label: '1K', description: 'Standard resolution' },
    { label: '2K', description: 'High resolution' },
    { label: '4K', description: 'Ultra high resolution' }
  ];

  const selected = await vscode.window.showQuickPick(resolutions, {
    placeHolder: 'Select resolution for generated images'
  });

  if (selected) {
    await vscode.workspace.getConfiguration('nanoBanana').update('defaultResolution', selected.label, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Resolution set to: ${selected.label}`);
  }
}

async function manageQuickPrompts() {
  const config = getConfig();
  const options = [
    { label: '$(add) Add New Prompt', action: 'add' },
    { label: '$(trash) Remove Prompt', action: 'remove' },
    { label: '$(edit) Edit Prompt', action: 'edit' },
    { label: '$(list-flat) View All Prompts', action: 'view' }
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'Manage Quick Prompts'
  });

  if (!selected) return;

  switch (selected.action) {
    case 'add':
      await addQuickPrompt();
      break;
    case 'remove':
      await removeQuickPrompt();
      break;
    case 'edit':
      await editQuickPrompt();
      break;
    case 'view':
      await viewQuickPrompts();
      break;
  }
}

async function addQuickPrompt() {
  const label = await vscode.window.showInputBox({
    prompt: 'Enter a name for this quick prompt',
    placeHolder: 'e.g., Make Cinematic'
  });
  if (!label) return;

  const prompt = await vscode.window.showInputBox({
    prompt: 'Enter the prompt',
    placeHolder: 'e.g., Apply a cinematic color grade with letterbox bars'
  });
  if (!prompt) return;

  const categories = ['style', 'edit', 'enhance', 'analyze', 'custom'];
  const category = await vscode.window.showQuickPick(categories, {
    placeHolder: 'Select a category'
  });

  const config = vscode.workspace.getConfiguration('nanoBanana');
  const prompts = config.get<QuickPrompt[]>('quickPrompts', []);
  prompts.push({ label, prompt, category: category || 'custom' });

  await config.update('quickPrompts', prompts, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Quick prompt "${label}" added!`);
}

async function removeQuickPrompt() {
  const config = getConfig();
  const items = config.quickPrompts.map(p => ({
    label: p.label,
    description: p.prompt.substring(0, 50) + '...'
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select prompt to remove'
  });

  if (selected) {
    const prompts = config.quickPrompts.filter(p => p.label !== selected.label);
    await vscode.workspace.getConfiguration('nanoBanana').update('quickPrompts', prompts, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Removed "${selected.label}"`);
  }
}

async function editQuickPrompt() {
  const config = getConfig();
  const items = config.quickPrompts.map(p => ({
    label: p.label,
    description: p.prompt.substring(0, 50) + '...',
    prompt: p
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select prompt to edit'
  });

  if (!selected) return;

  const newPrompt = await vscode.window.showInputBox({
    prompt: 'Edit the prompt',
    value: selected.prompt.prompt
  });

  if (newPrompt) {
    const prompts = config.quickPrompts.map(p =>
      p.label === selected.label ? { ...p, prompt: newPrompt } : p
    );
    await vscode.workspace.getConfiguration('nanoBanana').update('quickPrompts', prompts, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Updated "${selected.label}"`);
  }
}

async function viewQuickPrompts() {
  const config = getConfig();
  const items = config.quickPrompts.map(p => ({
    label: `${p.label} [${p.category || 'custom'}]`,
    detail: p.prompt
  }));

  await vscode.window.showQuickPick(items, {
    placeHolder: 'Your Quick Prompts',
    canPickMany: false
  });
}

// ==================== IMAGE GENERATION ====================

async function generateImage(context: vscode.ExtensionContext) {
  if (!await ensureAI()) return;

  // Pick model, aspect ratio, resolution
  const options = await pickModelBeforeAction();
  if (!options) return;

  const prompt = await vscode.window.showInputBox({
    placeHolder: 'Describe the image you want to generate...',
    prompt: 'Enter a detailed description for image generation',
    ignoreFocusOut: true
  });

  if (!prompt) return;

  const saveUri = await vscode.window.showSaveDialog({
    filters: { 'Images': ['png'] },
    defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'generated-image.png'))
  });

  if (!saveUri) return;

  await generateAndSaveImage(context, prompt, saveUri.fsPath, options);
}

async function generateImageInFolder(context: vscode.ExtensionContext, folderUri: vscode.Uri) {
  if (!await ensureAI()) return;

  // Pick model, aspect ratio, resolution
  const options = await pickModelBeforeAction();
  if (!options) return;

  const prompt = await vscode.window.showInputBox({
    placeHolder: 'Describe the image you want to generate...',
    prompt: 'Enter a detailed description for image generation',
    ignoreFocusOut: true
  });

  if (!prompt) return;

  const filename = await vscode.window.showInputBox({
    placeHolder: 'generated-image.png',
    prompt: 'Enter filename for the generated image',
    value: 'generated-image.png',
    ignoreFocusOut: true
  });

  if (!filename) return;

  const savePath = path.join(folderUri.fsPath, filename.endsWith('.png') ? filename : `${filename}.png`);
  await generateAndSaveImage(context, prompt, savePath, options);
}

async function generateAndSaveImage(context: vscode.ExtensionContext, prompt: string, savePath: string, options?: GenerationOptions) {
  const config = getConfig();
  const model = options?.model || config.model;
  const aspectRatio = options?.aspectRatio || config.aspectRatio;
  const resolution = options?.resolution || config.resolution;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Generating image...',
    cancellable: false
  }, async (progress) => {
    try {
      const modelName = model === 'gemini-2.5-flash-image' ? 'Banana Flash' : 'Banana Pro';
      progress.report({ message: `Using ${modelName}...` });

      let response;

      // Different API call format based on model
      if (model === 'gemini-2.5-flash-image') {
        // Flash model - simpler API
        response = await ai.models.generateContent({
          model: model,
          contents: prompt
        });
      } else {
        // Pro model - supports full config with aspect ratio and resolution
        response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: aspectRatio,
              imageSize: resolution
            }
          }
        });
      }

      let textResponse = '';
      let imageData: string | undefined;

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.text) {
          textResponse += part.text;
        } else if (part.inlineData) {
          imageData = part.inlineData.data;
        }
      }

      if (imageData) {
        const buffer = Buffer.from(imageData, 'base64');
        fs.writeFileSync(savePath, buffer);
        showImagePreview(context, savePath, textResponse);
        vscode.window.showInformationMessage(`Image saved to: ${savePath}`);
      } else {
        vscode.window.showErrorMessage('No image was generated.');
        if (textResponse) {
          showResultPanel(context, 'Generation Result', textResponse);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to generate image: ${error.message}`);
    }
  });
}

// ==================== IMAGE EDITING ====================

async function editImageFromEditor(context: vscode.ExtensionContext) {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && isImageFile(activeUri.fsPath)) {
    await editImage(context, activeUri.fsPath);
  } else {
    vscode.window.showErrorMessage('No image file is currently active.');
  }
}

async function editImageFromExplorer(context: vscode.ExtensionContext, uri: vscode.Uri) {
  if (!uri || !isImageFile(uri.fsPath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }
  await editImage(context, uri.fsPath);
}

async function editImage(context: vscode.ExtensionContext, imagePath: string) {
  if (!await ensureAI()) return;

  // Pick model, aspect ratio, resolution
  const options = await pickModelBeforeAction();
  if (!options) return;

  const prompt = await vscode.window.showInputBox({
    placeHolder: 'Describe how you want to edit this image...',
    prompt: 'Enter edit instructions',
    ignoreFocusOut: true
  });

  if (!prompt) return;

  const ext = path.extname(imagePath);
  const baseName = path.basename(imagePath, ext);
  const dir = path.dirname(imagePath);
  const defaultPath = path.join(dir, `${baseName}_edited.png`);

  const saveUri = await vscode.window.showSaveDialog({
    filters: { 'Images': ['png'] },
    defaultUri: vscode.Uri.file(defaultPath)
  });

  if (!saveUri) return;

  await editAndSaveImage(context, imagePath, prompt, saveUri.fsPath, options);
}

async function quickEdit(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  const config = getConfig();
  const items = config.quickPrompts.map(p => ({
    label: p.label,
    description: `[${p.category || 'custom'}]`,
    detail: p.prompt,
    prompt: p.prompt
  }));

  if (items.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No quick prompts configured.',
      'Add Quick Prompt',
      'Use Custom Prompt'
    );
    if (action === 'Add Quick Prompt') {
      await addQuickPrompt();
      return;
    } else if (action === 'Use Custom Prompt') {
      await editImage(context, imagePath);
      return;
    }
    return;
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a quick edit preset'
  });

  if (!selected) return;

  // Pick model, aspect ratio, resolution
  const options = await pickModelBeforeAction();
  if (!options) return;

  const ext = path.extname(imagePath);
  const baseName = path.basename(imagePath, ext);
  const dir = path.dirname(imagePath);
  const defaultPath = path.join(dir, `${baseName}_${selected.label.toLowerCase().replace(/\s+/g, '_')}.png`);

  const saveUri = await vscode.window.showSaveDialog({
    filters: { 'Images': ['png'] },
    defaultUri: vscode.Uri.file(defaultPath)
  });

  if (!saveUri) return;

  await editAndSaveImage(context, imagePath, selected.prompt, saveUri.fsPath, options);
}

async function editAndSaveImage(context: vscode.ExtensionContext, imagePath: string, prompt: string, savePath: string, options?: GenerationOptions) {
  const config = getConfig();
  const model = options?.model || config.model;
  const aspectRatio = options?.aspectRatio || config.aspectRatio;
  const resolution = options?.resolution || config.resolution;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Editing image...',
    cancellable: false
  }, async (progress) => {
    try {
      const modelName = model === 'gemini-2.5-flash-image' ? 'Banana Flash' : 'Banana Pro';
      progress.report({ message: `Using ${modelName}...` });

      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const contents = [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        }
      ];

      let response;

      // Different API call format based on model
      if (model === 'gemini-2.5-flash-image') {
        // Flash model - simpler API
        response = await ai.models.generateContent({
          model: model,
          contents: contents
        });
      } else {
        // Pro model - supports full config with aspect ratio and resolution
        response = await ai.models.generateContent({
          model: model,
          contents: contents,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: aspectRatio,
              imageSize: resolution
            }
          }
        });
      }

      let textResponse = '';
      let outputImageData: string | undefined;

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.text) {
          textResponse += part.text;
        } else if (part.inlineData) {
          outputImageData = part.inlineData.data;
        }
      }

      if (outputImageData) {
        const buffer = Buffer.from(outputImageData, 'base64');
        fs.writeFileSync(savePath, buffer);
        showComparisonPreview(context, imagePath, savePath, textResponse);
        vscode.window.showInformationMessage(`Edited image saved to: ${savePath}`);
      } else {
        vscode.window.showErrorMessage('No image was generated.');
        if (textResponse) {
          showResultPanel(context, 'Edit Result', textResponse);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to edit image: ${error.message}`);
    }
  });
}

async function composeImages(context: vscode.ExtensionContext) {
  if (!await ensureAI()) return;

  const imageUris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    openLabel: 'Select Images to Compose (2-14)'
  });

  if (!imageUris || imageUris.length < 2) {
    vscode.window.showErrorMessage('Please select at least 2 images.');
    return;
  }

  if (imageUris.length > 14) {
    vscode.window.showErrorMessage('Maximum 14 images can be composed.');
    return;
  }

  const prompt = await vscode.window.showInputBox({
    placeHolder: 'Describe how you want to combine these images...',
    prompt: 'Enter composition instructions',
    ignoreFocusOut: true
  });

  if (!prompt) return;

  const saveUri = await vscode.window.showSaveDialog({
    filters: { 'Images': ['png'] },
    defaultUri: vscode.Uri.file(path.join(path.dirname(imageUris[0].fsPath), 'composed-image.png'))
  });

  if (!saveUri) return;

  await composeAndSaveImages(context, imageUris.map(u => u.fsPath), prompt, saveUri.fsPath);
}

async function composeAndSaveImages(context: vscode.ExtensionContext, imagePaths: string[], prompt: string, savePath: string) {
  const config = getConfig();
  const model = 'gemini-3-pro-image-preview';

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Composing images...',
    cancellable: false
  }, async (progress) => {
    try {
      progress.report({ message: `Using ${model} with ${imagePaths.length} images...` });

      const contents: any[] = [{ text: prompt }];

      for (const imagePath of imagePaths) {
        const imageData = fs.readFileSync(imagePath);
        const base64Image = imageData.toString('base64');
        const mimeType = getMimeType(imagePath);

        contents.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        });
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: config.aspectRatio,
            imageSize: config.resolution
          }
        }
      });

      let textResponse = '';
      let outputImageData: string | undefined;

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.text) {
          textResponse += part.text;
        } else if (part.inlineData) {
          outputImageData = part.inlineData.data;
        }
      }

      if (outputImageData) {
        const buffer = Buffer.from(outputImageData, 'base64');
        fs.writeFileSync(savePath, buffer);
        showImagePreview(context, savePath, textResponse);
        vscode.window.showInformationMessage(`Composed image saved to: ${savePath}`);
      } else {
        vscode.window.showErrorMessage('No image was generated.');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to compose images: ${error.message}`);
    }
  });
}

// ==================== IMAGE UNDERSTANDING ====================

async function analyzeImage(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  const options = [
    { label: '$(comment) Describe Image', action: 'describe' },
    { label: '$(question) Ask About Image', action: 'ask' },
    { label: '$(symbol-misc) Detect Objects', action: 'detect' },
    { label: '$(layers) Segment Objects', action: 'segment' },
    { label: '$(symbol-text) Extract Text (OCR)', action: 'ocr' },
    { label: '$(shield) Detect Sensitive Data', action: 'sensitive' }
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'What would you like to do with this image?'
  });

  if (!selected) return;

  switch (selected.action) {
    case 'describe':
      await describeImage(context, uri);
      break;
    case 'ask':
      await askAboutImage(context, uri);
      break;
    case 'detect':
      await detectObjects(context, uri);
      break;
    case 'segment':
      await segmentObjects(context, uri);
      break;
    case 'ocr':
      await extractText(context, uri);
      break;
    case 'sensitive':
      await detectSensitiveData(context, uri);
      break;
  }
}

async function describeImage(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Analyzing image...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: 'Provide a detailed description of this image. Include information about the main subjects, colors, composition, mood, and any notable details.' }
        ]
      });

      const description = response.text || 'No description generated.';
      showResultPanel(context, 'Image Description', description, imagePath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to describe image: ${error.message}`);
    }
  });
}

async function askAboutImage(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  const question = await vscode.window.showInputBox({
    placeHolder: 'What would you like to know about this image?',
    prompt: 'Ask a question about the image',
    ignoreFocusOut: true
  });

  if (!question) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Analyzing image...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: question }
        ]
      });

      const answer = response.text || 'No answer generated.';
      showResultPanel(context, 'Image Analysis', `**Question:** ${question}\n\n**Answer:** ${answer}`, imagePath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to analyze image: ${error.message}`);
    }
  });
}

async function detectObjects(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Detecting objects...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const prompt = `Detect all prominent objects in this image. Return a JSON array where each object has:
- "label": the name of the object
- "box_2d": bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000
- "confidence": confidence level (high, medium, low)

Only return the JSON array, no other text.`;

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      const resultText = response.text || '[]';
      const detections = parseJsonResponse(resultText);

      // Get image dimensions
      const image = await Jimp.read(imagePath);
      const width = image.width;
      const height = image.height;

      showDetectionPreview(context, imagePath, detections, width, height, 'Object Detection Results');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to detect objects: ${error.message}`);
    }
  });
}

async function segmentObjects(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  const objectToSegment = await vscode.window.showInputBox({
    placeHolder: 'What objects to segment? (e.g., "all objects", "people", "cars")',
    value: 'all prominent objects',
    ignoreFocusOut: true
  });

  if (!objectToSegment) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Segmenting objects...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const prompt = `Give the segmentation masks for ${objectToSegment}.
Output a JSON list of segmentation masks where each entry contains:
- "box_2d": the 2D bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000
- "mask": the segmentation mask as a base64 encoded PNG
- "label": a descriptive text label

Only return the JSON array.`;

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: prompt }
        ],
        config: {
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const resultText = response.text || '[]';
      const segmentations = parseJsonResponse(resultText);

      const image = await Jimp.read(imagePath);
      const width = image.width;
      const height = image.height;

      showDetectionPreview(context, imagePath, segmentations, width, height, 'Segmentation Results');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to segment objects: ${error.message}`);
    }
  });
}

async function extractText(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Extracting text...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: 'Extract all text visible in this image. Preserve the layout and formatting as much as possible. If there is no text, say "No text found in image."' }
        ]
      });

      const extractedText = response.text || 'No text found.';
      showResultPanel(context, 'Extracted Text (OCR)', extractedText, imagePath);

      // Offer to copy to clipboard
      const action = await vscode.window.showInformationMessage(
        'Text extracted successfully!',
        'Copy to Clipboard'
      );
      if (action === 'Copy to Clipboard') {
        await vscode.env.clipboard.writeText(extractedText);
        vscode.window.showInformationMessage('Text copied to clipboard!');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to extract text: ${error.message}`);
    }
  });
}

// ==================== PRIVACY & SENSITIVE DATA ====================

function getSensitiveDataPrompt(): string {
  return globalState.get<string>(SENSITIVE_PROMPT_KEY) || DEFAULT_SENSITIVE_PROMPT;
}

async function improveDetectionPrompt(context: vscode.ExtensionContext) {
  if (!await ensureAI()) return;

  const feedback = await vscode.window.showInputBox({
    placeHolder: 'e.g., "it missed @botfather username" or "add Arabic names detection"',
    prompt: 'What should the detection improve? Describe what was missed or wrong.',
    ignoreFocusOut: true
  });

  if (!feedback) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Improving detection prompt...',
    cancellable: false
  }, async () => {
    try {
      const currentPrompt = getSensitiveDataPrompt();

      const enhanceRequest = `You are a prompt engineer. The user has a prompt for detecting sensitive data in screenshots. They provided feedback on what's not working.

CURRENT PROMPT:
${currentPrompt}

USER FEEDBACK:
${feedback}

Your task: Improve the prompt based on the feedback. Keep the same JSON output format. Only return the improved prompt text, nothing else. Do not include any explanation or markdown formatting.`;

      const config = getConfig();
      const response = await ai!.models.generateContent({
        model: config.understandingModel,
        contents: [{ text: enhanceRequest }]
      });

      const improvedPrompt = response.text?.trim();
      if (improvedPrompt) {
        await globalState.update(SENSITIVE_PROMPT_KEY, improvedPrompt);
        vscode.window.showInformationMessage('✓ Detection prompt improved! Try detecting again.');
        console.log('Nano Banana: Updated prompt:', improvedPrompt);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to improve prompt: ${error.message}`);
    }
  });
}

async function resetDetectionPrompt(context: vscode.ExtensionContext) {
  await globalState.update(SENSITIVE_PROMPT_KEY, undefined);
  vscode.window.showInformationMessage('✓ Detection prompt reset to default.');
}

async function detectSensitiveData(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  // Scan for sensitive data
  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Scanning for sensitive data...',
    cancellable: false
  }, async () => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      // Get the current prompt (custom or default)
      const prompt = getSensitiveDataPrompt();

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      const resultText = response.text || '[]';
      const detections = parseJsonResponse(resultText);

      const image = await Jimp.read(imagePath);
      const width = image.width;
      const height = image.height;

      return { detections, width, height };
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to detect sensitive data: ${error.message}`);
      return null;
    }
  });

  if (!result) return;

  const { detections, width, height } = result;

  if (detections.length === 0) {
    vscode.window.showInformationMessage('✅ No sensitive data found - image is safe to share!');
    return;
  }

  // Show preview with detections and blur buttons
  showDetectionPreview(context, imagePath, detections.map((d: any) => ({
    ...d,
    label: d.value ? `${d.type}: ${d.value}` : d.type
  })), width, height, 'Sensitive Data Found', true);
}

async function autoBlurSensitive(context: vscode.ExtensionContext, uri?: vscode.Uri) {
  const imagePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;

  if (!imagePath || !isImageFile(imagePath)) {
    vscode.window.showErrorMessage('Please select an image file.');
    return;
  }

  if (!await ensureAI()) return;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Detecting and blurring sensitive data...',
    cancellable: false
  }, async (progress) => {
    try {
      const config = getConfig();
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = getMimeType(imagePath);

      progress.report({ message: 'Scanning for sensitive data...' });

      const sensitiveTypes = config.sensitiveDataTypes.join(', ');
      const prompt = `Detect all sensitive or private information in this image. Look for: ${sensitiveTypes}.

Return a JSON array where each detected item has:
- "type": the type of sensitive data
- "box_2d": bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000

Only return the JSON array.`;

      const response = await ai.models.generateContent({
        model: config.understandingModel,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      const resultText = response.text || '[]';
      const detections = parseJsonResponse(resultText);

      if (detections.length === 0) {
        vscode.window.showInformationMessage('No sensitive data detected. Image is clean!');
        return;
      }

      progress.report({ message: `Blurring ${detections.length} region(s)...` });

      const image = await Jimp.read(imagePath);
      const width = image.width;
      const height = image.height;

      await blurRegions(context, imagePath, detections, width, height);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to auto-blur: ${error.message}`);
    }
  });
}

async function blurRegions(context: vscode.ExtensionContext, imagePath: string, detections: any[], _width: number, _height: number) {
  const config = getConfig();
  // Jimp blur uses radius 1-100
  const blurRadius = Math.min(Math.max(Math.round(config.blurIntensity / 2), 1), 100);

  try {
    // Create backup before modifying
    const ext = path.extname(imagePath);
    const baseName = path.basename(imagePath, ext);
    const dir = path.dirname(imagePath);
    const backupPath = path.join(dir, `${baseName}_backup${ext}`);

    // Only create backup if it doesn't exist (first blur)
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(imagePath, backupPath);
      console.log(`Nano Banana: Backup created at ${backupPath}`);
    }

    const image = await Jimp.read(imagePath);
    const width = image.width;
    const height = image.height;
    let regionsBlurred = 0;

    console.log(`Nano Banana: Blurring ${detections.length} detections on ${width}x${height} image`);

    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      if (!detection.box_2d || detection.box_2d.length !== 4) {
        console.log(`Nano Banana: Detection ${i} has no valid box_2d`);
        continue;
      }

      // Convert normalized coordinates (0-1000) to pixels
      const [ymin, xmin, ymax, xmax] = detection.box_2d;
      let x = Math.round((xmin / 1000) * width);
      let y = Math.round((ymin / 1000) * height);
      let w = Math.round(((xmax - xmin) / 1000) * width);
      let h = Math.round(((ymax - ymin) / 1000) * height);

      // Clamp to image bounds
      x = Math.max(0, Math.min(x, width - 1));
      y = Math.max(0, Math.min(y, height - 1));
      w = Math.min(w, width - x);
      h = Math.min(h, height - y);

      if (w <= 0 || h <= 0) {
        console.log(`Nano Banana: Detection ${i} has invalid dimensions after clamping`);
        continue;
      }

      console.log(`Nano Banana: Blurring region ${i}: x=${x}, y=${y}, w=${w}, h=${h}`);

      // Create blurred region and composite onto main image
      const blurredRegion = image.clone()
        .crop({ x, y, w, h })
        .blur(blurRadius);

      image.composite(blurredRegion, x, y);
      regionsBlurred++;
    }

    console.log(`Nano Banana: Blurred ${regionsBlurred} regions`);

    if (regionsBlurred > 0) {
      await image.write(imagePath as `${string}.${string}`);
      vscode.window.showInformationMessage(`✓ Blurred ${regionsBlurred} region(s). Backup: ${path.basename(backupPath)}`);
    } else {
      vscode.window.showWarningMessage('No valid regions to blur.');
    }
  } catch (error: any) {
    console.error('Nano Banana: Blur error:', error);
    vscode.window.showErrorMessage(`Failed to blur regions: ${error.message}`);
  }
}

async function restoreFromBackup(uri?: vscode.Uri) {
  const backupPath = uri?.fsPath;

  if (!backupPath) {
    vscode.window.showErrorMessage('Please right-click on a backup image file.');
    return;
  }

  // Check if it's a backup file
  if (!backupPath.includes('_backup')) {
    vscode.window.showErrorMessage('This is not a backup file. Backup files contain "_backup" in the name.');
    return;
  }

  // Get original filename by removing _backup
  const ext = path.extname(backupPath);
  const dir = path.dirname(backupPath);
  const backupBaseName = path.basename(backupPath, ext);
  const originalBaseName = backupBaseName.replace('_backup', '');
  const originalPath = path.join(dir, `${originalBaseName}${ext}`);

  try {
    // Copy backup to original
    fs.copyFileSync(backupPath, originalPath);

    // Delete the backup file
    fs.unlinkSync(backupPath);

    vscode.window.showInformationMessage(`✓ Restored to ${originalBaseName}${ext}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to restore: ${error.message}`);
  }
}

// ==================== PREVIEW PANELS ====================

function openImagePreview(context: vscode.ExtensionContext, uri: vscode.Uri) {
  showImagePreview(context, uri.fsPath);
}

function showImagePreview(context: vscode.ExtensionContext, imagePath: string, description?: string) {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'nanoBananaPreview',
      'Nano Banana Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.dirname(imagePath))]
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  const imageUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(imagePath));
  currentPanel.webview.html = getPreviewHtml(imageUri.toString(), path.basename(imagePath), description);
}

function showComparisonPreview(context: vscode.ExtensionContext, originalPath: string, editedPath: string, description?: string) {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'nanoBananaPreview',
      'Nano Banana - Before/After',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(originalPath)),
          vscode.Uri.file(path.dirname(editedPath))
        ]
      }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  const originalUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(originalPath));
  const editedUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(editedPath));
  currentPanel.webview.html = getComparisonHtml(originalUri.toString(), editedUri.toString(), description);
}

function showResultPanel(context: vscode.ExtensionContext, title: string, content: string, imagePath?: string) {
  const panel = vscode.window.createWebviewPanel(
    'nanoBananaResult',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: imagePath ? [vscode.Uri.file(path.dirname(imagePath))] : []
    }
  );

  let imageHtml = '';
  if (imagePath) {
    const imageUri = panel.webview.asWebviewUri(vscode.Uri.file(imagePath));
    imageHtml = `<img src="${imageUri}" alt="Image" style="max-width: 300px; border-radius: 8px; margin-bottom: 20px;" />`;
  }

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1e1e1e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    h1 {
      font-size: 18px;
      color: #ffd700;
      margin-bottom: 20px;
    }
    .content {
      background: #2d2d2d;
      padding: 20px;
      border-radius: 8px;
      white-space: pre-wrap;
      line-height: 1.6;
    }
    img {
      display: block;
    }
  </style>
</head>
<body>
  <h1>🍌 ${title}</h1>
  ${imageHtml}
  <div class="content">${content}</div>
</body>
</html>`;
}

function showDetectionPreview(context: vscode.ExtensionContext, imagePath: string, detections: any[], width: number, height: number, title: string, isSensitive: boolean = false) {
  const panel = vscode.window.createWebviewPanel(
    'nanoBananaDetection',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.dirname(imagePath))]
    }
  );

  const imageUri = panel.webview.asWebviewUri(vscode.Uri.file(imagePath));

  // Generate box data with detection info for blur
  const boxes = detections.map((d: any, i: number) => {
    if (!d.box_2d || d.box_2d.length !== 4) return null;

    const [ymin, xmin, ymax, xmax] = d.box_2d;
    const labelText = (d.label || (d.value ? `${d.type}: ${d.value}` : d.type) || 'Object').replace(/"/g, '\\"');

    return {
      left: `${xmin / 10}%`,
      top: `${ymin / 10}%`,
      width: `${(xmax - xmin) / 10}%`,
      height: `${(ymax - ymin) / 10}%`,
      label: labelText,
      num: i + 1,
      index: i
    };
  }).filter(Boolean);

  const boxesJson = JSON.stringify(boxes);

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'blur') {
      const indices = message.indices as number[];
      const selectedDetections = indices.map(i => detections[i]).filter(Boolean);
      if (selectedDetections.length > 0) {
        await blurRegions(context, imagePath, selectedDetections, width, height);
      }
    }
  });

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1e1e1e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    h1 {
      font-size: 18px;
      color: #ffd700;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #888;
      margin-bottom: 15px;
    }
    .actions {
      margin-bottom: 15px;
    }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      margin-right: 8px;
    }
    .btn-blur-all {
      background: #ff3333;
      color: white;
    }
    .btn-blur-all:hover {
      background: #cc2929;
    }
    .btn-blur {
      background: #444;
      color: white;
      padding: 4px 10px;
      font-size: 11px;
    }
    .btn-blur:hover {
      background: #ff3333;
    }
    .btn-blur.blurred {
      background: #2a5a2a;
      cursor: default;
    }
    .image-container {
      position: relative;
      display: inline-block;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
    .box {
      position: absolute;
      border: 3px solid #ff3333;
      pointer-events: none;
    }
    .box.blurred {
      border-color: #2a5a2a;
      opacity: 0.5;
    }
    .box-number {
      position: absolute;
      top: -12px;
      left: -12px;
      width: 24px;
      height: 24px;
      background: #ff3333;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    }
    .findings {
      margin-top: 20px;
      padding: 15px;
      background: #2d2d2d;
      border-radius: 8px;
    }
    .findings h2 {
      font-size: 14px;
      color: #ff3333;
      margin: 0 0 10px 0;
    }
    .finding-item {
      display: flex;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #3d3d3d;
    }
    .finding-item:last-child {
      border-bottom: none;
    }
    .finding-num {
      width: 24px;
      height: 24px;
      background: #ff3333;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .finding-text {
      color: #fff;
      flex: 1;
    }
    .finding-item.blurred .finding-num {
      background: #2a5a2a;
    }
    .finding-item.blurred .finding-text {
      text-decoration: line-through;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <h1>🔍 ${title}</h1>
  <p class="subtitle">Found ${detections.length} item(s)</p>

  <div class="actions">
    <button class="btn btn-blur-all" onclick="blurAll()">🔒 Blur All</button>
  </div>

  <div class="image-container" id="container">
    <img src="${imageUri}" alt="Image" onload="drawBoxes()" />
  </div>

  <div class="findings" id="findings">
    <h2>⚠️ Detected Items</h2>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const boxes = ${boxesJson};
    const blurredIndices = new Set();

    function drawBoxes() {
      const container = document.getElementById('container');
      const findings = document.getElementById('findings');

      boxes.forEach((box) => {
        // Draw rectangle with number
        const div = document.createElement('div');
        div.className = 'box';
        div.id = 'box-' + box.index;
        div.style.left = box.left;
        div.style.top = box.top;
        div.style.width = box.width;
        div.style.height = box.height;

        const numBadge = document.createElement('div');
        numBadge.className = 'box-number';
        numBadge.textContent = box.num;
        div.appendChild(numBadge);

        container.appendChild(div);

        // Add to findings list with blur button
        const item = document.createElement('div');
        item.className = 'finding-item';
        item.id = 'item-' + box.index;
        item.innerHTML = \`
          <div class="finding-num">\${box.num}</div>
          <div class="finding-text">\${box.label}</div>
          <button class="btn btn-blur" onclick="blurOne(\${box.index})">Blur</button>
        \`;
        findings.appendChild(item);
      });
    }

    function blurOne(index) {
      if (blurredIndices.has(index)) return;
      vscode.postMessage({ command: 'blur', indices: [index] });
      markAsBlurred(index);
    }

    function blurAll() {
      const indices = boxes.map(b => b.index).filter(i => !blurredIndices.has(i));
      if (indices.length === 0) return;
      vscode.postMessage({ command: 'blur', indices });
      indices.forEach(i => markAsBlurred(i));
    }

    function markAsBlurred(index) {
      blurredIndices.add(index);
      const box = document.getElementById('box-' + index);
      const item = document.getElementById('item-' + index);
      if (box) box.classList.add('blurred');
      if (item) {
        item.classList.add('blurred');
        const btn = item.querySelector('.btn-blur');
        if (btn) {
          btn.textContent = '✓ Blurred';
          btn.classList.add('blurred');
        }
      }
    }
  </script>
</body>
</html>`;
}

// ==================== UTILITY FUNCTIONS ====================

function getPreviewHtml(imageUri: string, filename: string, description?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nano Banana Preview</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1e1e1e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    h1 {
      font-size: 18px;
      margin-bottom: 10px;
      color: #ffd700;
    }
    .filename {
      font-size: 14px;
      color: #888;
      margin-bottom: 20px;
    }
    .image-container {
      max-width: 100%;
      overflow: auto;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    }
    .description {
      margin-top: 20px;
      padding: 15px;
      background: #2d2d2d;
      border-radius: 8px;
      max-width: 600px;
      font-size: 14px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>🍌 Nano Banana</h1>
  <div class="filename">${filename}</div>
  <div class="image-container">
    <img src="${imageUri}" alt="Generated Image" />
  </div>
  ${description ? `<div class="description">${description}</div>` : ''}
</body>
</html>`;
}

function getComparisonHtml(originalUri: string, editedUri: string, description?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nano Banana - Before/After</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1e1e1e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    h1 {
      font-size: 18px;
      text-align: center;
      color: #ffd700;
      margin-bottom: 20px;
    }
    .comparison {
      display: flex;
      gap: 20px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .image-box {
      flex: 1;
      min-width: 300px;
      max-width: 500px;
    }
    .image-box h2 {
      font-size: 14px;
      color: #888;
      margin-bottom: 10px;
      text-align: center;
    }
    img {
      width: 100%;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    }
    .description {
      margin-top: 20px;
      padding: 15px;
      background: #2d2d2d;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>🍌 Nano Banana - Before/After</h1>
  <div class="comparison">
    <div class="image-box">
      <h2>Original</h2>
      <img src="${originalUri}" alt="Original Image" />
    </div>
    <div class="image-box">
      <h2>Edited</h2>
      <img src="${editedUri}" alt="Edited Image" />
    </div>
  </div>
  ${description ? `<div class="description">${description}</div>` : ''}
</body>
</html>`;
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  return mimeTypes[ext] || 'image/png';
}

function parseJsonResponse(text: string): any[] {
  try {
    // Try to parse directly
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        return [];
      }
    }

    // Try to find array in text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    }

    return [];
  }
}

export function deactivate() {
  if (currentPanel) {
    currentPanel.dispose();
  }
}

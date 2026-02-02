import * as vscode from 'vscode';
import * as path from 'path';

export class BananaImageEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'bananaStudio.imagePreview';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BananaImageEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      BananaImageEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        },
        supportsMultipleEditorsPerDocument: true
      }
    );
  }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        this.context.extensionUri
      ]
    };

    const imageUri = webviewPanel.webview.asWebviewUri(document.uri);
    const imagePath = document.uri.fsPath;

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, imageUri.toString(), imagePath);

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'editImage':
          vscode.commands.executeCommand('nanoBanana.editImageFromExplorer', document.uri);
          break;
        case 'quickEdit':
          vscode.commands.executeCommand('nanoBanana.quickEdit', document.uri);
          break;
        case 'analyzeImage':
          vscode.commands.executeCommand('nanoBanana.analyzeImage', document.uri);
          break;
        case 'describeImage':
          vscode.commands.executeCommand('nanoBanana.describeImage', document.uri);
          break;
        case 'detectObjects':
          vscode.commands.executeCommand('nanoBanana.detectObjects', document.uri);
          break;
        case 'extractText':
          vscode.commands.executeCommand('nanoBanana.extractText', document.uri);
          break;
        case 'detectSensitive':
          vscode.commands.executeCommand('nanoBanana.detectSensitiveData', document.uri);
          break;
        case 'autoBlur':
          vscode.commands.executeCommand('nanoBanana.autoBlurSensitive', document.uri);
          break;
        case 'copyImage':
          // Copy image to clipboard
          try {
            await vscode.env.clipboard.writeText(document.uri.fsPath);
            vscode.window.showInformationMessage('Image path copied to clipboard');
          } catch (e) {
            vscode.window.showErrorMessage('Failed to copy');
          }
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview, imageUri: string, imagePath: string): string {
    const fileName = path.basename(imagePath);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      background: #1e1e1e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .image-container {
      position: relative;
      max-width: 100%;
      max-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    img {
      max-width: 100vw;
      max-height: 100vh;
      object-fit: contain;
      cursor: pointer;
    }

    .context-menu {
      position: fixed;
      background: #252526;
      border: 1px solid #454545;
      border-radius: 6px;
      padding: 4px 0;
      min-width: 200px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: none;
    }

    .context-menu.show {
      display: block;
    }

    .menu-item {
      padding: 8px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }

    .menu-item:hover {
      background: #094771;
    }

    .menu-item .icon {
      width: 16px;
      text-align: center;
      opacity: 0.8;
    }

    .menu-separator {
      height: 1px;
      background: #454545;
      margin: 4px 0;
    }

    .menu-header {
      padding: 6px 16px;
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .submenu-arrow {
      margin-left: auto;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="image-container">
    <img src="${imageUri}" alt="${fileName}" id="image" />
  </div>

  <div class="context-menu" id="contextMenu">
    <div class="menu-header">🍌 Banana Studio</div>
    <div class="menu-item" data-action="editImage">
      <span class="icon">✏️</span>
      <span>Edit Image with AI</span>
    </div>
    <div class="menu-item" data-action="quickEdit">
      <span class="icon">⚡</span>
      <span>Quick Edit with Preset</span>
    </div>
    <div class="menu-separator"></div>
    <div class="menu-item" data-action="describeImage">
      <span class="icon">💬</span>
      <span>Describe Image</span>
    </div>
    <div class="menu-item" data-action="detectObjects">
      <span class="icon">🔍</span>
      <span>Detect Objects</span>
    </div>
    <div class="menu-item" data-action="extractText">
      <span class="icon">📝</span>
      <span>Extract Text (OCR)</span>
    </div>
    <div class="menu-separator"></div>
    <div class="menu-item" data-action="detectSensitive">
      <span class="icon">🛡️</span>
      <span>Detect Sensitive Data</span>
    </div>
    <div class="menu-item" data-action="autoBlur">
      <span class="icon">🔒</span>
      <span>Auto-Blur Sensitive</span>
    </div>
    <div class="menu-separator"></div>
    <div class="menu-item" data-action="copyImage">
      <span class="icon">📋</span>
      <span>Copy Path</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const contextMenu = document.getElementById('contextMenu');
    const image = document.getElementById('image');

    // Show context menu on right-click
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu.style.left = e.clientX + 'px';
      contextMenu.style.top = e.clientY + 'px';
      contextMenu.classList.add('show');
    });

    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        contextMenu.classList.remove('show');
      }
    });

    // Handle menu item clicks
    document.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        vscode.postMessage({ command: action });
        contextMenu.classList.remove('show');
      });
    });

    // Hide on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        contextMenu.classList.remove('show');
      }
    });
  </script>
</body>
</html>`;
  }
}

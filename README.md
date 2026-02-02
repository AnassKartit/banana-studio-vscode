# 🍌 Banana Studio - AI Image Generation & Editing for VS Code

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=banana-studio.banana-studio)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Author:** [Anass Kartit](https://kartit.net)

Generate, edit, and analyze images using Google's Gemini AI models directly in VS Code. Banana Studio brings powerful AI image capabilities to your development workflow.

![Banana Studio Demo](images/demo.gif)

## ✨ Features

### 🎨 Image Generation
- **Text-to-Image**: Generate images from text descriptions
- **Multiple Models**: Choose between Banana Flash (fast) and Banana Pro (high quality)
- **Aspect Ratios**: 1:1, 16:9, 9:16, 4:3, 3:4, and more
- **Resolutions**: 1K, 2K, up to 4K

### ✏️ Image Editing
- **AI-Powered Editing**: Edit images with natural language prompts
- **Quick Edit Presets**: Save and reuse your favorite editing prompts
- **Compose Images**: Combine up to 14 images into new compositions
- **Before/After Preview**: Visual comparison of changes

### 🔍 Image Understanding
- **Describe Image**: Get detailed AI descriptions of any image
- **Object Detection**: Detect objects with bounding boxes
- **Text Extraction (OCR)**: Extract text from images
- **Ask Questions**: Ask anything about an image

### 🛡️ Privacy & Security
- **Sensitive Data Detection**: Automatically detect faces, IDs, credit cards, etc.
- **Auto-Blur**: One-click blur of all sensitive information
- **Configurable Detection**: Customize what types of data to detect

### 🖼️ Custom Image Editor
- **Right-Click Context Menu**: Full Banana Studio menu when viewing images
- **Integrated Preview**: View and edit images without leaving VS Code

## 📦 Installation

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Banana Studio"
4. Click Install

## 🔑 Setup

### Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Copy the key

### Configure Banana Studio

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run "Banana Studio: Set API Key"
3. Paste your API key (stored securely)

## 🚀 Usage

### Generate a New Image

1. Press `Cmd+Shift+G` (Mac) or `Ctrl+Shift+G` (Windows/Linux)
2. Select your model (Flash or Pro)
3. If Pro: choose aspect ratio and resolution
4. Enter your prompt
5. Choose where to save

### Edit an Existing Image

**Method 1: Right-click in Explorer**
- Right-click on any image → 🍌 Banana Studio → Edit Image with AI

**Method 2: Keyboard Shortcut**
- Open an image, press `Cmd+Shift+E` / `Ctrl+Shift+E`

**Method 3: Custom Image Editor**
- Right-click image → Open With → Banana Studio Image Editor
- Then right-click on the image for full context menu

### Quick Edit with Presets

1. Press `Cmd+Shift+Q` / `Ctrl+Shift+Q`
2. Select from your saved presets
3. Image is edited automatically

### Detect & Blur Sensitive Data

1. Right-click on image → 🍌 Banana Studio → Auto-Blur Sensitive Data
2. Or press `Cmd+Shift+B` / `Ctrl+Shift+B`
3. AI detects and blurs all sensitive information

## ⌨️ Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Generate Image | `Cmd+Shift+G` | `Ctrl+Shift+G` |
| Edit Image | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Quick Edit | `Cmd+Shift+Q` | `Ctrl+Shift+Q` |
| Analyze Image | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| Auto-Blur | `Cmd+Shift+B` | `Ctrl+Shift+B` |

## ⚙️ Settings

Access via `Preferences → Settings → Extensions → Banana Studio`

| Setting | Description | Default |
|---------|-------------|---------|
| `defaultModel` | Default AI model | `gemini-2.5-flash-image` |
| `understandingModel` | Model for analysis | `gemini-3-flash-preview` |
| `defaultAspectRatio` | Default aspect ratio | `1:1` |
| `defaultResolution` | Default resolution | `1K` |
| `quickPrompts` | Your saved presets | (see below) |
| `sensitiveDataTypes` | Data types to detect | faces, IDs, etc. |
| `blurIntensity` | Blur strength (5-100) | `25` |

### Default Quick Prompts

```json
[
  { "label": "Make Vintage", "prompt": "Apply a vintage film effect with warm tones" },
  { "label": "Add Sunset", "prompt": "Add a beautiful sunset sky in the background" },
  { "label": "Remove Background", "prompt": "Remove the background and make it white" },
  { "label": "Enhance Quality", "prompt": "Enhance the image quality and sharpness" },
  { "label": "Make Professional", "prompt": "Make this image look more professional" },
  { "label": "Add Blur Background", "prompt": "Add a professional bokeh blur to the background" }
]
```

## 🤖 AI Models

### Banana Flash (`gemini-2.5-flash-image`)
- **Speed**: Fast generation
- **Best for**: Quick iterations, drafts, high-volume tasks
- **Features**: Basic image generation and editing

### Banana Pro (`gemini-3-pro-image-preview`)
- **Quality**: Professional-grade output
- **Best for**: Final assets, detailed work, complex compositions
- **Features**: Aspect ratio, resolution control, Google Search grounding

## 📋 Commands

All commands available via Command Palette (`Cmd+Shift+P`):

- `Banana Studio: Generate New Image`
- `Banana Studio: Edit Image with AI`
- `Banana Studio: Quick Edit with Preset`
- `Banana Studio: Analyze Image`
- `Banana Studio: Describe Image`
- `Banana Studio: Detect Objects`
- `Banana Studio: Extract Text (OCR)`
- `Banana Studio: Detect Sensitive Data`
- `Banana Studio: Auto-Blur Sensitive Data`
- `Banana Studio: Compose Multiple Images`
- `Banana Studio: Set API Key`
- `Banana Studio: Select AI Model`
- `Banana Studio: Set Aspect Ratio`
- `Banana Studio: Set Resolution`
- `Banana Studio: Manage Quick Prompts`

## 🔒 Privacy & Security

- **API Key Storage**: Your API key is stored securely using VS Code's SecretStorage API (encrypted by your OS)
- **Local Processing**: Images are sent to Google's Gemini API for processing
- **No Data Collection**: Banana Studio does not collect or store any of your data

## 🐛 Troubleshooting

### "AI not initialized" Error
1. Run "Banana Studio: Set API Key"
2. Enter a valid Gemini API key
3. Ensure you have API access enabled

### "Invalid argument" Error
- Try switching to Banana Pro model for complex operations
- Ensure your image is in a supported format (PNG, JPG, JPEG, GIF, WEBP, BMP)

### Context Menu Not Appearing
1. Ensure the extension is activated
2. Restart VS Code
3. Check that you're right-clicking on a supported image format

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Google Gemini](https://deepmind.google/technologies/gemini/) for the AI models
- [Sharp](https://sharp.pixelplumbing.com/) for image processing
- VS Code team for the excellent extension API

---

**Made with 🍌 by [Anass Kartit](https://kartit.net)**

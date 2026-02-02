# Changelog

All notable changes to the Banana Studio extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-31

### Added

#### Image Generation
- Text-to-image generation using Gemini AI models
- Support for two models: Banana Flash (fast) and Banana Pro (high quality)
- Configurable aspect ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- Configurable resolutions: 1K, 2K, 4K (Pro model only)
- Model picker dialog before each generation
- Progress notifications during generation

#### Image Editing
- AI-powered image editing with natural language prompts
- Quick Edit presets for common operations
- Image composition (combine up to 14 images)
- Before/After comparison preview

#### Image Understanding
- Describe Image: Get detailed AI descriptions
- Object Detection with bounding boxes
- Image Segmentation
- Text Extraction (OCR)
- Ask questions about any image

#### Privacy & Security
- Sensitive data detection (faces, IDs, credit cards, etc.)
- Auto-blur sensitive information
- Configurable sensitive data types
- Adjustable blur intensity

#### User Interface
- Custom Image Editor with right-click context menu
- Explorer context menu integration
- Editor title bar icons
- Keyboard shortcuts for all major actions
- Quick prompt management (add, edit, remove presets)

#### Security
- Secure API key storage using VS Code SecretStorage
- Environment variable fallback support

### Technical
- TypeScript codebase
- Sharp library for image processing
- Google GenAI SDK integration
- Webview-based preview panels

## [Unreleased]

### Planned
- Batch image processing
- Image history/undo
- Cloud sync for presets
- More AI models support

---

For more information, visit [GitHub Repository](https://github.com/AnasSarkworker/banana-studio-vscode)

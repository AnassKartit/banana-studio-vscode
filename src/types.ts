/**
 * Banana Studio - Type Definitions
 * @author Anass Kartit (https://kartit.net)
 */

// ==================== MODELS ====================

export const MODELS = {
  FLASH: 'gemini-2.5-flash-image',
  PRO: 'gemini-3-pro-image-preview',
  UNDERSTANDING: 'gemini-3-flash-preview'
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];

export const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export type AspectRatio = typeof ASPECT_RATIOS[number];

export const RESOLUTIONS = ['1K', '2K', '4K'] as const;
export type Resolution = typeof RESOLUTIONS[number];

// ==================== CONFIGURATION ====================

export interface QuickPrompt {
  label: string;
  prompt: string;
  category?: 'style' | 'edit' | 'enhance' | 'analyze' | 'custom';
}

export interface BananaStudioConfig {
  readonly model: ModelType;
  readonly understandingModel: string;
  readonly aspectRatio: AspectRatio;
  readonly resolution: Resolution;
  readonly enableGoogleSearch: boolean;
  readonly quickPrompts: QuickPrompt[];
  readonly sensitiveDataTypes: string[];
  readonly blurIntensity: number;
}

export interface GenerationOptions {
  model: string;
  aspectRatio: string;
  resolution: string;
}

// ==================== API RESPONSES ====================

export interface ContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface ContentResponse {
  candidates?: Array<{
    content?: {
      parts?: ContentPart[];
    };
  }>;
  text?: string;
}

export interface GenerationRequest {
  model: string;
  contents: string | ContentPart[];
  config?: {
    responseModalities?: string[];
    responseMimeType?: string;
    imageConfig?: {
      aspectRatio?: string;
      imageSize?: string;
    };
    thinkingConfig?: {
      thinkingBudget?: number;
    };
  };
}

// ==================== DETECTION ====================

export interface BoundingBox {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  label: string;
  mask?: string;
  confidence?: 'high' | 'medium' | 'low';
  type?: string;
  risk_level?: 'high' | 'medium' | 'low';
  description?: string;
}

export interface DetectionResult {
  boxes: BoundingBox[];
  width: number;
  height: number;
}

// ==================== QUICK PICK OPTIONS ====================

export interface ModelQuickPickItem {
  label: string;
  description: string;
  detail?: string;
  value: ModelType;
}

export interface AspectRatioQuickPickItem {
  label: string;
  description: string;
  value: AspectRatio;
}

export interface ResolutionQuickPickItem {
  label: string;
  description: string;
  value: Resolution;
}

// ==================== UTILITY TYPES ====================

export type AppError = Error | { message: string } | unknown;

export function getErrorMessage(error: AppError): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

// ==================== HTML ESCAPING ====================

export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

// ==================== VALIDATION ====================

export function isValidBoundingBox(box: unknown): box is BoundingBox {
  if (typeof box !== 'object' || box === null) return false;
  const b = box as Record<string, unknown>;
  return Array.isArray(b.box_2d) &&
         b.box_2d.length === 4 &&
         b.box_2d.every((n: unknown) => typeof n === 'number');
}

export function validateApiKey(value: string): string | null {
  if (!value) return 'API key is required';
  if (value.trim().length < 20) return 'API key appears too short';
  if (!value.match(/^AIza[a-zA-Z0-9_-]{35,}$/)) {
    return 'API key format appears invalid (should start with AIza...)';
  }
  return null;
}

export function parseAndValidateDetections(text: string): BoundingBox[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch {
        // Try to find array in text
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            parsed = JSON.parse(arrayMatch[0]);
          } catch {
            return [];
          }
        } else {
          return [];
        }
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isValidBoundingBox);
}

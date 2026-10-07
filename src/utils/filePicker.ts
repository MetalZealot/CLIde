type OpenFilePickerOptions = {
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: OpenFilePickerOptions) => Promise<{ getFile: () => Promise<File> }[]>;
};

/**
 * Images through the file browser. A file input whose `accept` lists only images opens
 * Android's Photo Picker, and Chrome cannot read some of its files (crbug 428394446).
 */
export const IMAGE_PICKER_OPTIONS: OpenFilePickerOptions = {
  types: [{
    description: 'Images',
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif'] },
  }],
  excludeAcceptAllOption: true,
};

export const hasOpenFilePicker = () =>
  typeof window !== 'undefined' && typeof (window as FilePickerWindow).showOpenFilePicker === 'function';

/** Call synchronously from the tap: the picker needs its user activation. Resolves `[]` on cancel. */
export const openFilePicker = async (options: OpenFilePickerOptions): Promise<File[]> => {
  try {
    const handles = await (window as FilePickerWindow).showOpenFilePicker!(options);
    return await Promise.all(handles.map((handle) => handle.getFile()));
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return [];
    throw error;
  }
};

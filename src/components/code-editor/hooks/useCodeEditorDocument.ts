import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { CodeEditorFile } from '../types/types';
import { isBinaryFile } from '../utils/binaryFile';
import { getPreviewKind } from '../utils/previewableFile';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  // The buffer then holds an error notice, which must never be saved over the file.
  const [loadFailed, setLoadFailed] = useState(false);
  // What disk holds as far as this editor knows; `content` differing from it is unsaved work.
  const [savedContent, setSavedContent] = useState('');
  // Some binaries (images, PDFs, audio, video) can be rendered natively, so the
  // editor shows an inline preview instead of the generic binary placeholder.
  const previewKind = getPreviewKind(file.name);
  // `fileProjectId` is the DB primary key passed down from the editor sidebar;
  // the fallback to `projectPath` preserves older callers that didn't yet
  // propagate the identifier.
  const fileProjectId = file.projectId ?? projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const isReadOnly = Boolean(file.readOnly);
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;
  const hasDiffInfo = Boolean(file.diffInfo);
  // Identity of the open document. A move or rename rewrites `path`/`name`
  // while keeping this stable, so the load effect below must key on it rather
  // than the path — otherwise relocating a file would silently reload it from
  // disk and throw away an unsaved buffer. Callers that never mint an id fall
  // back to the path and keep the original behavior.
  const documentKey = file.documentId ?? filePath;

  // Read inside the effect without making the effect depend on them: the
  // current path/name are what to load *when the document changes*, not a
  // reason to load again.
  const currentFileRef = useRef({ filePath, fileName });
  currentFileRef.current = { filePath, fileName };

  useEffect(() => {
    // A slower read for the previous document must not land in this one's buffer.
    let cancelled = false;
    const showContent = (text: string) => {
      setContent(text);
      setSavedContent(text);
    };

    const loadFileContent = async () => {
      const { filePath: currentPath, fileName: currentName } = currentFileRef.current;

      try {
        setLoading(true);
        setIsBinary(false);
        setLoadFailed(false);

        // Natively previewable media (image/pdf/audio/video) is rendered by
        // CodeEditorMediaPreview, so there is nothing to read as text here.
        // Clear any buffer left over from a previously opened text file so a
        // stray save can't write stale content over the binary file.
        if (getPreviewKind(currentName)) {
          showContent('');
          setLoading(false);
          return;
        }

        // Check if file is binary by extension
        if (isBinaryFile(currentName)) {
          showContent('');
          setIsBinary(true);
          setLoading(false);
          return;
        }

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (hasDiffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          showContent(fileDiffNewString);
          setLoading(false);
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, currentPath);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (cancelled) return;
        showContent(data.content);
      } catch (error) {
        if (cancelled) return;
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        setLoadFailed(true);
        showContent(`// Error loading file: ${message}\n// File: ${currentName}\n// Path: ${currentPath}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadFileContent();
    return () => {
      cancelled = true;
    };
  }, [documentKey, hasDiffInfo, fileDiffNewString, fileDiffOldString, fileProjectId]);

  const handleSave = useCallback(async () => {
    // Preview-only and binary files have no editable text buffer; never write
    // them back (e.g. via Cmd/Ctrl+S) or we'd corrupt the file on disk.
    if (previewKind || isBinaryFile(fileName) || isReadOnly || loadFailed) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, filePath, content);

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      setSavedContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [content, filePath, fileProjectId, previewKind, fileName, isReadOnly, loadFailed]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = file.name;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [content, file.name]);

  return {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    loadFailed,
    isDirty: !loading && !loadFailed && content !== savedContent,
    previewKind,
    fileProjectId,
    handleSave,
    handleDownload,
  };
};

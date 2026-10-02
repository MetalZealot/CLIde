import { readApiErrorMessage } from '../../auth/utils';

export const gitEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const readErrorMessageFromResponse = async (response: Response, fallback: string) => {
  try {
    return readApiErrorMessage(await response.json()) ?? fallback;
  } catch {
    return fallback;
  }
};

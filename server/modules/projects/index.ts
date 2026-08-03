export {
  generateDisplayName,
  getProjectsWithSessions,
} from './services/projects-with-sessions-fetch.service.js';
export { updateProjectDisplayName } from './services/project-management.service.js';
// createProject: used by Projects routes and the clone service to register a directory as a switchable project.
export { createProject } from './services/project-management.service.js';
// deleteOrArchiveProject: used by Projects routes to hide or permanently remove a project.
export { deleteOrArchiveProject, deleteSessionJsonlFilesForProjectPath } from './services/project-delete.service.js';
// restoreArchivedProject: used by Projects routes to re-activate an archived project.
export { restoreArchivedProject } from './services/project-delete.service.js';
export {
  canonicalizeMoveSources,
  moveFilesIntoDirectory,
  normalizeSourcePathsInput,
  MAX_MOVE_SOURCES,
} from './services/file-move.service.js';
export type {
  MoveConflict,
  MovedEntry,
  MoveEntryType,
  MoveFilesResult,
  SkippedEntry,
} from './services/file-move.service.js';

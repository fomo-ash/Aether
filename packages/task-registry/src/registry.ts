import { TaskMetadata } from './types';

const registry = new Map<string, TaskMetadata>();

export function registerTask(task: TaskMetadata): void {
  if (registry.has(task.id)) {
    throw new Error(`Task with id ${task.id} is already registered.`);
  }
  registry.set(task.id, task);
}

export function getTask(id: string): TaskMetadata | undefined {
  return registry.get(id);
}

export function hasTask(id: string): boolean {
  return registry.has(id);
}

export function listTasks(): TaskMetadata[] {
  return Array.from(registry.values());
}\n
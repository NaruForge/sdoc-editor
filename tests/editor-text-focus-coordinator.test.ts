import { describe, expect, it } from 'vitest';
import { EditorTextFocusCoordinator } from '../src/editorTextFocusCoordinator';

const firstIdentity = { sessionId: 'session-1', documentId: 'file:///first.sdoc' };
const secondIdentity = { sessionId: 'session-2', documentId: 'file:///second.sdoc' };

describe('EditorTextFocusCoordinator', () => {
  it('only grants a focus lease to an active panel', () => {
    const coordinator = new EditorTextFocusCoordinator<object>();
    const panel = {};

    expect(coordinator.update(panel, firstIdentity, true, false)).toBe(false);
    expect(coordinator.currentLease).toBeUndefined();

    expect(coordinator.update(panel, firstIdentity, true, true)).toBe(true);
    expect(coordinator.owns(panel, firstIdentity)).toBe(true);
  });

  it('clears the owning lease on blur or panel deactivation', () => {
    const coordinator = new EditorTextFocusCoordinator<object>();
    const panel = {};

    coordinator.update(panel, firstIdentity, true, true);
    expect(coordinator.update(panel, firstIdentity, false, true)).toBe(true);
    expect(coordinator.currentLease).toBeUndefined();

    coordinator.update(panel, firstIdentity, true, true);
    expect(coordinator.update(panel, firstIdentity, true, false)).toBe(true);
    expect(coordinator.currentLease).toBeUndefined();
  });

  it('does not let a stale panel or identity clear the current lease', () => {
    const coordinator = new EditorTextFocusCoordinator<object>();
    const oldPanel = {};
    const activePanel = {};

    coordinator.update(oldPanel, firstIdentity, true, true);
    coordinator.update(activePanel, secondIdentity, true, true);

    expect(coordinator.release(oldPanel, firstIdentity)).toBe(false);
    expect(coordinator.release(activePanel, firstIdentity)).toBe(false);
    expect(coordinator.owns(activePanel, secondIdentity)).toBe(true);
  });

  it('clears the current lease during provider disposal', () => {
    const coordinator = new EditorTextFocusCoordinator<object>();
    coordinator.update({}, firstIdentity, true, true);

    expect(coordinator.clear()).toBe(true);
    expect(coordinator.clear()).toBe(false);
    expect(coordinator.currentLease).toBeUndefined();
  });
});

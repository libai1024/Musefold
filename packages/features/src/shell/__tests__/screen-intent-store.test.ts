import { describe, expect, it } from 'vitest';
import { useScreenIntent } from '../screen-intent-store';

describe('useScreenIntent settings deep links', () => {
  it('stores settings-section payload and consume returns it once', () => {
    useScreenIntent.setState({ intent: null });
    useScreenIntent.getState().setIntent({
      kind: 'settings-section',
      section: 'connections',
      highlight: 'settings-ai-connections-card',
    });
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'connections',
      highlight: 'settings-ai-connections-card',
    });
    const consumed = useScreenIntent.getState().consume('settings-section');
    expect(consumed).toEqual({
      kind: 'settings-section',
      section: 'connections',
      highlight: 'settings-ai-connections-card',
    });
    expect(useScreenIntent.getState().intent).toBeNull();
    expect(useScreenIntent.getState().consume('settings-section')).toBeNull();
  });

  it('keeps settings-account / settings-connections aliases', () => {
    useScreenIntent.setState({ intent: { kind: 'settings-account' } });
    expect(useScreenIntent.getState().consume('settings-connections')).toBeNull();
    expect(useScreenIntent.getState().consume('settings-account')).toEqual({
      kind: 'settings-account',
    });

    useScreenIntent.getState().setIntent({ kind: 'settings-connections' });
    expect(useScreenIntent.getState().consume('settings-connections')).toEqual({
      kind: 'settings-connections',
    });
  });
});

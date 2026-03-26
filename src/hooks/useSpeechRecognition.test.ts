import { renderHook, act } from '@testing-library/react';

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  start() {
    this.onstart?.();
  }

  stop() {
    this.onend?.();
  }
}

// Set up the global before the module is loaded so the module-level
// constant `SpeechRecognitionAPI` picks it up.
(window as any).SpeechRecognition = MockSpeechRecognition;

// Use require after setting the global so the module-level constant is initialized.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useSpeechRecognition } = require('./useSpeechRecognition');

afterAll(() => {
  delete (window as any).SpeechRecognition;
});

beforeEach(() => {
  jest.restoreAllMocks();
});

function createInstanceCapture() {
  let captured: MockSpeechRecognition | null = null;
  jest.spyOn(MockSpeechRecognition.prototype, 'start').mockImplementation(function (this: MockSpeechRecognition) {
    captured = this;
    this.onstart?.();
  });
  return () => captured;
}

describe('useSpeechRecognition', () => {
  it('returns initial state', () => {
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets isListening to true when started', () => {
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    expect(result.current.isListening).toBe(true);
  });

  it('sets isListening to false when stopped', () => {
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.stopListening();
    });

    expect(result.current.isListening).toBe(false);
  });

  it('calls onResult with transcript', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    const instance = getInstance();
    expect(instance).not.toBeNull();

    act(() => {
      instance!.onresult?.({
        results: [{ 0: { transcript: 'hello world', confidence: 0.95 } }],
        resultIndex: 0,
      });
    });

    expect(onResult).toHaveBeenCalledWith('hello world');
  });

  it('sets error on recognition error', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    expect(result.current.isListening).toBe(true);

    act(() => {
      getInstance()!.onerror?.({ error: 'not-allowed' });
    });

    expect(result.current.error).toBe('not-allowed');
    expect(result.current.isListening).toBe(false);
  });

  it('ignores aborted errors', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    act(() => {
      getInstance()!.onerror?.({ error: 'aborted' });
    });

    expect(result.current.error).toBeNull();
  });

  it('clears error on startListening', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    act(() => {
      getInstance()!.onerror?.({ error: 'not-allowed' });
    });

    expect(result.current.error).toBe('not-allowed');

    act(() => {
      result.current.startListening();
    });

    expect(result.current.error).toBeNull();
  });

  it('clears error via clearError', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    act(() => {
      getInstance()!.onerror?.({ error: 'network' });
    });

    expect(result.current.error).toBe('network');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('nulls old instance handlers when restarting to prevent race conditions', () => {
    const instances: MockSpeechRecognition[] = [];
    jest.spyOn(MockSpeechRecognition.prototype, 'start').mockImplementation(function (this: MockSpeechRecognition) {
      instances.push(this);
      this.onstart?.();
    });
    jest.spyOn(MockSpeechRecognition.prototype, 'stop').mockImplementation(function () {
      // Don't fire onend — simulates async stop where onend fires later
    });

    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    // Start first session
    act(() => {
      result.current.startListening();
    });

    const firstInstance = instances[0];
    expect(firstInstance).toBeDefined();
    expect(firstInstance.onend).not.toBeNull();

    // Start second session (should null out first instance's handlers)
    act(() => {
      result.current.startListening();
    });

    // First instance's handlers should be nulled
    expect(firstInstance.onstart).toBeNull();
    expect(firstInstance.onresult).toBeNull();
    expect(firstInstance.onerror).toBeNull();
    expect(firstInstance.onend).toBeNull();

    // Second instance should be active
    expect(result.current.isListening).toBe(true);

    // Simulate the first instance's onend firing late — handler was nulled so nothing happens
    act(() => {
      firstInstance.onend?.();
    });

    // Should still be listening because the handler was nulled
    expect(result.current.isListening).toBe(true);
  });

  it('stops recognition on unmount', () => {
    const getInstance = createInstanceCapture();
    const stopSpy = jest.spyOn(MockSpeechRecognition.prototype, 'stop');

    const onResult = jest.fn();
    const { result, unmount } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    expect(getInstance()).not.toBeNull();
    stopSpy.mockClear();

    unmount();

    expect(stopSpy).toHaveBeenCalled();
  });

  it('uses the latest onResult callback via ref', () => {
    const getInstance = createInstanceCapture();
    const onResult1 = jest.fn();
    const onResult2 = jest.fn();

    const { result, rerender } = renderHook(({ cb }) => useSpeechRecognition(cb), {
      initialProps: { cb: onResult1 },
    });

    act(() => {
      result.current.startListening();
    });

    // Re-render with a new callback
    rerender({ cb: onResult2 });

    act(() => {
      getInstance()!.onresult?.({
        results: [{ 0: { transcript: 'test', confidence: 0.9 } }],
        resultIndex: 0,
      });
    });

    expect(onResult1).not.toHaveBeenCalled();
    expect(onResult2).toHaveBeenCalledWith('test');
  });

  it('does not call onResult for empty transcript', () => {
    const getInstance = createInstanceCapture();
    const onResult = jest.fn();
    const { result } = renderHook(() => useSpeechRecognition(onResult));

    act(() => {
      result.current.startListening();
    });

    act(() => {
      getInstance()!.onresult?.({
        results: [{ 0: { transcript: '', confidence: 0 } }],
        resultIndex: 0,
      });
    });

    expect(onResult).not.toHaveBeenCalled();
  });
});

import "@testing-library/jest-dom/vitest";

// node 环境的 store/纯逻辑测试没有 window，DOM 相关补丁只在 DOM 环境生效。
if (typeof window !== "undefined") {
  // assistant-ui 的虚拟列表/滚动容器探测用。
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  }

  if (typeof globalThis.IntersectionObserver === "undefined") {
    class IntersectionObserverStub {
      root = null;
      rootMargin = "";
      thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver =
      IntersectionObserverStub as unknown as typeof IntersectionObserver;
  }

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

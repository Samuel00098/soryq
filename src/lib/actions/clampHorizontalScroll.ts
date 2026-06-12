export function clampHorizontalScroll(node: HTMLElement) {
  let frame = 0;

  const maxScroll = () => {
    const style = getComputedStyle(node);
    const trailingPadding = Number.parseFloat(style.paddingRight) || 0;
    return Math.max(0, node.scrollWidth - node.clientWidth - trailingPadding);
  };

  const clamp = () => {
    frame = 0;
    const max = maxScroll();
    const next = Math.min(Math.max(node.scrollLeft, 0), max);
    if (Math.abs(next - node.scrollLeft) > 0.5) {
      node.scrollLeft = next;
    }
  };

  const scheduleClamp = () => {
    if (frame) return;
    frame = requestAnimationFrame(clamp);
  };

  const handleWheel = (event: WheelEvent) => {
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!delta) return;

    const max = maxScroll();
    const current = node.scrollLeft;
    const next = Math.min(Math.max(current + delta, 0), max);

    if (next !== current || (delta < 0 && current <= 0) || (delta > 0 && current >= max)) {
      event.preventDefault();
      node.scrollLeft = next;
    }
  };

  node.addEventListener('scroll', scheduleClamp, { passive: true });
  node.addEventListener('wheel', handleWheel, { passive: false });

  const resizeObserver = new ResizeObserver(scheduleClamp);
  resizeObserver.observe(node);
  scheduleClamp();

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener('scroll', scheduleClamp);
      node.removeEventListener('wheel', handleWheel);
      resizeObserver.disconnect();
    }
  };
}

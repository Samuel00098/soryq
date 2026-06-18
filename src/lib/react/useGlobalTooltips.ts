import { useEffect } from 'react';

export function useGlobalTooltips() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Create the tooltip element
    let tooltipEl = document.getElementById('soryq-global-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'soryq-global-tooltip';
      tooltipEl.className = 'global-tooltip';
      document.body.appendChild(tooltipEl);
    }

    let activeElement: HTMLElement | null = null;
    let showTimeout: any = null;

    const positionTooltip = (trigger: HTMLElement, tooltip: HTMLElement) => {
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      // Default: position centered above the trigger
      let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      let top = triggerRect.top - tooltipRect.height - 8;

      // Constrain to window bounds
      if (left < 8) left = 8;
      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tooltipRect.width - 8;
      }

      // If it overflows the top of the window, position it below the trigger instead
      if (top < 8) {
        top = triggerRect.bottom + 8;
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[title], [data-tooltip]') as HTMLElement | null;
      if (!target || target === activeElement) return;

      // Clear previous timeout
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }

      activeElement = target;

      // Extract content
      let content = target.getAttribute('data-tooltip');
      if (!content) {
        content = target.getAttribute('title') || '';
        if (content) {
          target.setAttribute('data-tooltip', content);
          target.removeAttribute('title'); // Prevent native tooltip
        }
      }

      if (!content || !tooltipEl) return;

      // Schedule the tooltip to show after a short delay
      showTimeout = setTimeout(() => {
        if (!tooltipEl || !target) return;
        tooltipEl.textContent = content;
        tooltipEl.classList.add('visible');
        positionTooltip(target, tooltipEl);
      }, 300); // 300ms premium delay
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }

      if (!activeElement || !tooltipEl) return;

      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget && activeElement.contains(relatedTarget)) {
        return;
      }

      activeElement = null;
      tooltipEl.classList.remove('visible');
    };

    const handleMouseDown = () => {
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
      }
    };

    const handleMouseLeaveWindow = () => {
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      if (tooltipEl) {
        tooltipEl.classList.remove('visible');
      }
      activeElement = null;
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseleave', handleMouseLeaveWindow, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseleave', handleMouseLeaveWindow, true);
      if (tooltipEl && tooltipEl.parentNode) {
        tooltipEl.parentNode.removeChild(tooltipEl);
      }
    };
  }, []);
}

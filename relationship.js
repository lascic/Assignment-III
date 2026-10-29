const SVG_NS = 'http://www.w3.org/2000/svg';
let chartCount = 0;

/** Equal-weight country statistics for one set of exact same-year observations. */
export function computeRelationship(points) {
  const values = points.filter(point =>
    Number.isFinite(point.schooling) && Number.isFinite(point.literate)
  );
  const n = values.length;
  if (n < 2) return {n, r: null, slope: null, intercept: null};
  const meanX = values.reduce((sum, point) => sum + point.schooling, 0) / n;
  const meanY = values.reduce((sum, point) => sum + point.literate, 0) / n;
  let xx = 0, yy = 0, xy = 0;
  for (const point of values) {
    const x = point.schooling - meanX;
    const y = point.literate - meanY;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  const slope = xx > 0 ? xy / xx : null;
  const intercept = slope === null ? null : meanY - slope * meanX;
  const r = xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  return {n, r, slope, intercept};
}

function element(name, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function pointerPosition(event, node) {
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && event.type !== 'focus') {
    return {clientX: event.clientX, clientY: event.clientY, pointerType:event.pointerType};
  }
  const bounds = node.getBoundingClientRect();
  return {clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2};
}

/**
 * Linked SVG scatterplot. Input points must already be joined by country and year.
 * Each circle remains at its exact data coordinates; no jitter or imputation.
 */
export function createRelationshipChart(svg, callbacks = {}) {
  const id = `schooling-literacy-chart-${++chartCount}`;
  let points = [];
  let year = null;
  let xMax = 16;
  let highlightedCode = null;
  let circles = new Map();
  let lastWidth = null;
  let destroyed = false;

  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-labelledby', `${id}-title`);
  svg.setAttribute('aria-describedby', `${id}-description`);
  svg.style.display = 'block';
  svg.style.width = '100%';

  function highlight(code) {
    highlightedCode = code ?? null;
    for (const [pointCode, circle] of circles) {
      const selected = pointCode === highlightedCode;
      const china = pointCode === 'CHN';
      circle.classList.toggle('is-highlighted', selected);
      circle.setAttribute('r', selected ? 7 : china ? 6 : 4.5);
      circle.setAttribute('stroke', selected ? '#0c2f59' : china ? '#202d30' : '#fffffc');
      circle.setAttribute('stroke-width', selected ? 2.6 : china ? 1.8 : .8);
      circle.setAttribute('fill-opacity', selected || china ? 1 : .86);
    }
  }

  function draw() {
    if (destroyed) return;
    const focusedCode = svg.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-code') : null;
    const width = Math.max(260, svg.clientWidth || 760);
    lastWidth = width;
    const compact = width < 480;
    const height = Math.max(310, Math.min(450, width * .62));
    const margin = {top: 24, right: compact ? 16 : 24, bottom: 68, left: compact ? 52 : 64};
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = value => margin.left + value / xMax * plotWidth;
    const y = value => margin.top + (1 - value / 100) * plotHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.height = `${height}px`;
    svg.replaceChildren();
    circles = new Map();

    svg.append(
      element('title', {id: `${id}-title`}, `Schooling and literacy in ${year ?? 'the selected year'}`),
      element('desc', {id: `${id}-description`}, `Each dot is one country with both schooling and literacy observations in ${year ?? 'the selected year'}. ${points.length} countries are shown. The horizontal axis measures average years of schooling for ages 15 to 64. The vertical axis measures adult literacy as a percentage. China has an outlined dot. The dashed line is the equal-weight linear trend across countries in this year.`)
    );

    const definitions = element('defs');
    const clip = element('clipPath', {id: `${id}-plot-clip`});
    clip.append(element('rect', {x: margin.left, y: margin.top, width: plotWidth, height: plotHeight}));
    definitions.append(clip);
    svg.append(definitions);

    const grid = element('g', {class: 'chart-grid', 'aria-hidden': 'true'});
    for (let value = 0; value <= 100; value += 20) {
      grid.append(
        element('line', {x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value), stroke: '#dde4d7', 'stroke-width': 1}),
        element('text', {x: margin.left - 10, y: y(value) + 4, 'text-anchor': 'end', fill: '#75816d', 'font-size': 11}, value)
      );
    }
    svg.append(grid);

    const axes = element('g', {class: 'chart-axes', 'aria-hidden': 'true'});
    axes.append(
      element('line', {x1: margin.left, x2: margin.left, y1: margin.top, y2: y(0), stroke: '#b7c3b0', 'stroke-width': 1}),
      element('line', {x1: margin.left, x2: width - margin.right, y1: y(0), y2: y(0), stroke: '#b7c3b0', 'stroke-width': 1})
    );
    const desiredTickCount = compact ? 4 : 7;
    const rawStep = xMax / desiredTickCount;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= rawStep) * magnitude;
    for (let value = 0; value <= xMax + 1e-9; value += step) {
      const rounded = Number(value.toFixed(6));
      axes.append(
        element('line', {x1: x(rounded), x2: x(rounded), y1: y(0), y2: y(0) + 5, stroke: '#b7c3b0', 'stroke-width': 1}),
        element('text', {x: x(rounded), y: y(0) + 20, 'text-anchor': 'middle', fill: '#75816d', 'font-size': 11}, rounded)
      );
    }
    const xTitle = element('text', {
      class: 'chart-x-label', x: margin.left + plotWidth / 2, y: height - 16,
      'text-anchor': 'middle', fill: '#526344', 'font-size': 12
    });
    if (compact) {
      xTitle.append(
        element('tspan', {x: margin.left + plotWidth / 2, dy: -11}, 'Average years of schooling'),
        element('tspan', {x: margin.left + plotWidth / 2, dy: 15}, '(ages 15–64)')
      );
    } else xTitle.textContent = 'Average years of schooling (ages 15–64)';
    axes.append(
      xTitle,
      element('text', {
        class: 'chart-y-label', x: 14, y: margin.top + plotHeight / 2,
        transform: `rotate(-90 14 ${margin.top + plotHeight / 2})`,
        'text-anchor': 'middle', fill: '#526344', 'font-size': 12
      }, 'Adult literacy rate (%)')
    );
    svg.append(axes);

    const statistics = computeRelationship(points);
    if (statistics.n >= 3 && statistics.slope !== null) {
      const trend = element('g', {'clip-path': `url(#${id}-plot-clip)`, 'aria-hidden': 'true'});
      trend.append(element('line', {
        class: 'chart-trend', x1: x(0), x2: x(xMax),
        y1: y(statistics.intercept), y2: y(statistics.intercept + statistics.slope * xMax),
        stroke: '#5c776b', 'stroke-width': 1.6, 'stroke-dasharray': '6 5', 'stroke-opacity': .75
      }));
      svg.append(trend);
    }

    const dotLayer = element('g', {class: 'chart-points'});
    const orderedPoints = [...points].sort((a, b) => Number(a.code === 'CHN') - Number(b.code === 'CHN'));
    for (const point of orderedPoints) {
      const circle = element('circle', {
        class: 'chart-point', cx: x(point.schooling), cy: y(point.literate),
        r: point.code === 'CHN' ? 6 : 4.5, fill: point.color ?? '#2861da',
        'data-code': point.code, tabindex: 0, role: 'button',
        'aria-label': `${point.name}, ${year}: ${point.schooling.toFixed(2)} years of schooling and ${point.literate.toFixed(1)} percent literacy`
      });
      circle.style.cursor = 'pointer';
      circle.addEventListener('pointerenter', event => callbacks.onHover?.(point, pointerPosition(event, circle)));
      circle.addEventListener('pointerleave', event => callbacks.onLeave?.(point,event));
      circle.addEventListener('focus', event => callbacks.onHover?.(point, pointerPosition(event, circle)));
      circle.addEventListener('blur', event => callbacks.onLeave?.(point,event));
      circle.addEventListener('click', event => callbacks.onSelect?.(point, pointerPosition(event, circle)));
      circle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          callbacks.onSelect?.(point, pointerPosition(event, circle));
        }
      });
      circles.set(point.code, circle);
      dotLayer.append(circle);
    }
    svg.append(dotLayer);
    const china = points.find(point => point.code === 'CHN');
    if (china) {
      const rightAligned = x(china.schooling) > width - margin.right - 44;
      svg.append(element('text', {
        class: 'chart-china-label', x: x(china.schooling) + (rightAligned ? -10 : 10),
        y: y(china.literate) < margin.top + 16 ? y(china.literate) + 20 : y(china.literate) - 9,
        'text-anchor': rightAligned ? 'end' : 'start', fill: '#26382d', 'font-size': 11,
        'font-weight': 600, 'pointer-events': 'none', 'aria-hidden': 'true'
      }, 'China'));
    }
    if (!points.length) {
      svg.append(element('text', {
        x: margin.left + plotWidth / 2, y: margin.top + plotHeight / 2,
        'text-anchor': 'middle', fill: '#75816d', 'font-size': 13
      }, 'No matching country-year observations.'));
    }
    highlight(highlightedCode);
    if (focusedCode && circles.has(focusedCode)) circles.get(focusedCode).focus({preventScroll: true});
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const width = Math.max(260, svg.clientWidth || 760);
    if (lastWidth !== width) draw();
  }) : null;
  resizeObserver?.observe(svg);

  return {
    setData(nextPoints, options = {}) {
      year = options.year;
      points = nextPoints.filter(point =>
        Number(point.year) === Number(year) &&
        Number.isFinite(point.schooling) && Number.isFinite(point.literate)
      );
      const largest = Math.max(0, ...points.map(point => point.schooling));
      xMax = Math.max(1, Number.isFinite(options.xMax) ? options.xMax : Math.ceil(largest / 2) * 2, largest);
      draw();
      return computeRelationship(points);
    },
    highlight,
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      svg.replaceChildren();
      circles.clear();
    }
  };
}

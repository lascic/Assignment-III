import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createRelationshipChart } from './relationship.js';

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatRate = (value) => value === null ? 'No data' : `${value.toFixed(1)}%`;
const state = { year: 2010, selected: null, hovered: null, dragging: false };
let data, schoolingData, features, renderer, scene, camera, controls, sphere, texture, textureContext, paths;
let relationshipChart, matchedPoints = [], relationshipStats = null, chartXMax = 14;
let featureByCode = new Map();
let pickContext, pickPixels, highlight;
let lastPointer = null, frameRequested = false, keyboardMoving = false;
let tooltipAnchor = null, tooltipHideTimer = null;
let sliderFrame = null;
let selectableYears = [];
let globeFocus = null, lastFrameTime = null;
let plotZoomCode = null, plotZoomTimer = null, plotZoomTouch = false;
const countryViewCache = new Map();
const DEFAULT_GLOBE_DISTANCE = 3.45;
const container = $('globe-container');
const tooltip = $('country-tooltip');
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const WIDTH = 4096, HEIGHT = 2048;
const noDataColor = '#bfc5c3';
const palette = [[241,214,101],[196,214,161],[143,199,187],[98,164,206],[40,97,218]];
const paletteStops = [0,.3,.5,.7,1];

// Every lookup is for this exact year. A missing observation stays missing.
function observation(code, year = state.year) {
  return data.countries[code]?.observations[String(year)] ?? null;
}
function schoolingObservation(code, year = state.year) {
  return schoolingData.countries[code]?.observations[String(year)] ?? null;
}
function pairedObservation(code, year = state.year) {
  const literacy=observation(code,year), schooling=schoolingObservation(code,year);
  if (!Number.isFinite(literacy?.literate) || !Number.isFinite(schooling?.years)) return null;
  return {
    code, year, name:data.countries[code]?.name ?? schoolingData.countries[code]?.name ?? code,
    schooling:schooling.years, literate:literacy.literate, illiterate:literacy.illiterate,
    color:literacyColor(literacy.literate)
  };
}
function pointsForYear(year) {
  return [...featureByCode.keys()].map(code=>pairedObservation(code,year)).filter(Boolean);
}
function literacyColor(rate) {
  if (rate === null || !Number.isFinite(rate)) return noDataColor;
  const t = Math.min(1, Math.max(0, rate / 100));
  let i = 0;
  while (i < paletteStops.length - 2 && t > paletteStops[i + 1]) i++;
  const local = (t - paletteStops[i]) / (paletteStops[i + 1] - paletteStops[i]);
  const rgb = palette[i].map((v, channel) => Math.round(v + (palette[i + 1][channel] - v) * local));
  return `rgb(${rgb.join(',')})`;
}
function nameOf(feature) {
  return data.countries[feature.properties.code]?.name ?? feature.properties.name;
}
function comparisonText(code) {
  const value = pairedObservation(code), china = pairedObservation('CHN');
  if (!value) return `No exact schooling–literacy match in ${state.year}.`;
  if (!china) return `China has no matching observations in ${state.year}.`;
  if (code === 'CHN') return 'China is the comparison point.';
  const delta = value.literate - china.literate;
  if (Math.abs(delta) < .05) return 'The same literacy rate as China.';
  return `${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? 'above' : 'below'} China.`;
}

function nearestComparisonYear(code, year = state.year) {
  // Compare actual observations from a shared year; prefer the earlier year in a tie.
  const sharedYears = selectableYears.filter(value => pairedObservation(code,value) && pairedObservation('CHN',value));
  sharedYears.sort((a,b) => Math.abs(a-year)-Math.abs(b-year) || a-b);
  return sharedYears[0] ?? null;
}

function comparisonActionHTML(code) {
  if (code === 'CHN' || (pairedObservation(code) && pairedObservation('CHN'))) return '';
  const year = nearestComparisonYear(code);
  if (year === null) return '<p class="no-shared-year">No shared year with both measures for this country and China.</p>';
  return `<div class="comparison-action"><span>Closest shared year with both measures</span><button type="button" class="compare-year-button" data-comparison-code="${escapeHTML(code)}" data-comparison-year="${year}">Compare in ${year} <span aria-hidden="true">→</span></button></div>`;
}

function drawTexture() {
  const ctx = textureContext;
  ctx.fillStyle = '#dfebeb';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  features.forEach((feature, index) => {
    const value = pairedObservation(feature.properties.code);
    ctx.fillStyle = literacyColor(value?.literate ?? null);
    ctx.fill(paths[index]);
  });
  ctx.lineWidth = .85; ctx.strokeStyle = '#f8faf0';
  paths.forEach((path) => ctx.stroke(path));
  texture.needsUpdate = true;
  requestRender();
}

function makeCountryOutline(feature) {
  relationshipChart?.highlight(feature?.properties.code ?? null);
  if (highlight) {
    scene.remove(highlight); highlight.geometry.dispose(); highlight.material.dispose(); highlight = null;
  }
  if (!feature) { requestRender(); return; }
  const points = [];
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i=0; i<ring.length-1; i++) {
      const a = latLonVector(ring[i][0],ring[i][1],1.003);
      const b = latLonVector(ring[i+1][0],ring[i+1][1],1.003);
      points.push(a.x,a.y,a.z,b.x,b.y,b.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  highlight = new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x133f84,transparent:true,opacity:.9,depthWrite:false}));
  scene.add(highlight); requestRender();
}

function latLonVector(lon,lat,radius=1) {
  const phi=THREE.MathUtils.degToRad(lon), theta=THREE.MathUtils.degToRad(lat);
  return new THREE.Vector3(radius*Math.cos(theta)*Math.cos(phi),radius*Math.sin(theta),-radius*Math.cos(theta)*Math.sin(phi));
}

function countryView(feature) {
  const code=feature.properties.code;
  if (countryViewCache.has(code)) return countryViewCache.get(code);
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const ranked=polygons.map(coordinates=>({coordinates,area:d3.geoArea({type:'Polygon',coordinates})})).sort((a,b)=>b.area-a.area);
  const total=ranked.reduce((sum,polygon)=>sum+polygon.area,0);
  let geometry={type:'Polygon',coordinates:ranked[0].coordinates};
  if (ranked[0].area<.7*total) {
    // Frame the main archipelago, excluding tiny remote islands from the fit.
    let covered=0;
    const major=[];
    for (const polygon of ranked) {
      major.push(polygon.coordinates);covered+=polygon.area;
      if(covered>=.95*total)break;
    }
    geometry={type:'MultiPolygon',coordinates:major};
  }
  const [lon,lat]=d3.geoCentroid(geometry);
  const direction=latLonVector(lon,THREE.MathUtils.clamp(lat,
    90-THREE.MathUtils.radToDeg(controls.maxPolarAngle),
    90-THREE.MathUtils.radToDeg(controls.minPolarAngle)
  ));
  const components=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  let radius=0;
  for(const polygon of components)for(const ring of polygon)for(const [x,y] of ring){
    radius=Math.max(radius,direction.angleTo(latLonVector(x,y)));
  }
  const view={direction,radius};
  countryViewCache.set(code,view);
  return view;
}

function animateGlobeView(target) {
  // Consume orbit inertia without an intermediate camera jump.
  const position=camera.position.clone(), damping=controls.enableDamping;
  controls.enableDamping=false;
  controls.update();
  camera.position.copy(position);
  controls.update();
  controls.enableDamping=damping;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    globeFocus=null;
    camera.position.copy(controls.target).addScaledVector(target.direction,target.distance);
    controls.update();
  } else {
    globeFocus=target;
    lastFrameTime=null;
  }
  requestRender();
}

function focusGlobe(feature) {
  const {direction,radius}=countryView(feature);
  const verticalHalf=THREE.MathUtils.degToRad(camera.fov)/2;
  const horizontalHalf=Math.atan(Math.tan(verticalHalf)*camera.aspect);
  const padding=.8*Math.tan(Math.min(verticalHalf,horizontalHalf));
  const distance=THREE.MathUtils.clamp(Math.cos(radius)+Math.sin(radius)/padding,controls.minDistance,2.9);
  if(globeFocus?.code===feature.properties.code && Math.abs(globeFocus.distance-distance)<.001)return;
  animateGlobeView({code:feature.properties.code,direction,distance});
}

function cancelPlotZoom() {
  clearTimeout(plotZoomTimer);plotZoomTimer=null;
  plotZoomCode=null;plotZoomTouch=false;
}

function resetPlotZoom() {
  cancelPlotZoom();
  const direction=camera.position.clone().sub(controls.target).normalize();
  animateGlobeView({code:null,direction,distance:DEFAULT_GLOBE_DISTANCE});
}

function leavePlotCountry(point,event) {
  scheduleTooltipHide();
  if(point.code!==plotZoomCode || plotZoomTouch || event?.pointerType==='touch')return;
  if(event?.type==='blur' && event.currentTarget.matches(':hover'))return;
  clearTimeout(plotZoomTimer);
  const code=point.code;
  plotZoomTimer=setTimeout(()=>{
    if(plotZoomCode===code){
      resetPlotZoom();
      dismissTooltip();
    }
  },100);
}

function comparisonIcon(code) {
  const value = pairedObservation(code), china = pairedObservation('CHN');
  if (!value || !china) return '—';
  const delta = value.literate - china.literate;
  return Math.abs(delta) < .05 ? '=' : delta < 0 ? '↘' : '↗';
}

function tooltipHTML(feature) {
  const code = feature.properties.code, value = pairedObservation(code), china = pairedObservation('CHN');
  const row = (country,name,record,key,max,reference=false) => {
    const width=record?Math.min(100,Math.max(0,100*record[key]/max)):0;
    const label=record?(key==='schooling'?record.schooling.toFixed(2)+' yr':formatRate(record.literate)):'No matched data';
    return `<div class="metric-row${reference?' is-reference':''}" data-country="${escapeHTML(country)}"><div class="metric-row-label"><span>${escapeHTML(name)}</span><strong class="${record?'':'tooltip-missing'}">${label}</strong></div><div class="metric-track${record?'':' is-missing'}" aria-hidden="true">${record?`<span class="metric-bar" style="width:${width}%"></span>`:''}</div></div>`;
  };
  const metric = (key,title,max,scale) => `<section class="tooltip-metric" data-metric="${key}" aria-label="${title} comparison"><div class="metric-heading"><h3>${title}</h3><span>${scale}</span></div>${row(code,nameOf(feature),value,key,max)}${code==='CHN'?'':row('CHN','China',china,key,max,true)}</section>`;
  return `<div class="tooltip-top"><h2>${escapeHTML(nameOf(feature))}</h2><span>${state.year}</span></div>${metric('schooling','Average years of schooling',chartXMax,`0–${chartXMax} years`)}${metric('literate','Literacy rate',100,'0–100%')}<p class="tooltip-delta"><span class="baseline-icon" aria-hidden="true">${comparisonIcon(code)}</span><span>${escapeHTML(comparisonText(code))}</span></p>${comparisonActionHTML(code)}`;
}
function showTooltip(feature,event) {
  clearTimeout(tooltipHideTimer);
  const alreadyVisible = !tooltip.hidden && state.hovered === feature;
  if (state.hovered !== feature) {
    state.selected = null;
    state.hovered = feature;
    tooltip.innerHTML = tooltipHTML(feature);
    makeCountryOutline(feature);
  }
  // Keep the card still so its comparison button can be reached with the pointer.
  if (alreadyVisible) return;
  tooltipAnchor = {clientX:event.clientX,clientY:event.clientY};
  tooltip.hidden = false;
  positionTooltip();
}
function positionTooltip() {
  if (!tooltipAnchor || tooltip.hidden) return;
  const bounds = {width:window.innerWidth,height:window.innerHeight};
  const localX = tooltipAnchor.clientX, localY = tooltipAnchor.clientY;
  const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
  let x = localX + 20, y = localY - 30;
  if (x + width > bounds.width - 12) x = localX - width - 20;
  if (x < 12) x = Math.max(12,Math.min(bounds.width - width - 12,localX));
  y = Math.min(bounds.height - height - 12,Math.max(12,y));
  tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
}
function hideTooltip() {
  cancelPlotZoom();
  globeFocus=null;
  dismissTooltip();
}
function dismissTooltip() {
  clearTimeout(tooltipHideTimer);
  tooltipAnchor = null;
  tooltip.hidden = true;
  if (state.hovered || state.selected) {
    state.hovered = null; state.selected = null; makeCountryOutline(null);
  }
}
function scheduleTooltipHide() {
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = setTimeout(() => {
    if (!state.selected && !tooltip.matches(':hover') && !tooltip.contains(document.activeElement)) hideTooltip();
  }, 150);
}
function inTooltipBridge(event) {
  if (tooltip.hidden || !tooltipAnchor || !tooltip.querySelector('button')) return false;
  const rect = tooltip.getBoundingClientRect();
  const direction = tooltipAnchor.clientX < rect.left ? 1 : -1;
  const edge = direction === 1 ? rect.left : rect.right;
  const a = {x:tooltipAnchor.clientX-direction*8,y:tooltipAnchor.clientY};
  const b = {x:edge+direction*8,y:rect.top-8};
  const c = {x:edge+direction*8,y:rect.bottom+8};
  const p = {x:event.clientX,y:event.clientY};
  const side = (p,a,b) => (p.x-b.x)*(a.y-b.y)-(a.x-b.x)*(p.y-b.y);
  const signs = [side(p,a,b),side(p,b,c),side(p,c,a)];
  // Preserve the country while crossing the small gap into the interactive card.
  return !(signs.some(value=>value<0) && signs.some(value=>value>0));
}
function featureAt(event) {
  const rect = container.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hits = raycaster.intersectObject(sphere);
  if (!hits.length) return null;
  const {uv} = hits[0];
  const x = Math.min(WIDTH-1,Math.max(0,Math.floor(uv.x*WIDTH)));
  const y = Math.min(HEIGHT-1,Math.max(0,Math.floor((1-uv.y)*HEIGHT)));
  const offset = (y*WIDTH+x)*4;
  const id = pickPixels[offset] + (pickPixels[offset+1]<<8);
  const candidate = id ? features[id-1] : null;
  const location = [uv.x*360-180,uv.y*180-90];
  // Verify the encoded pixel, so antialiasing at borders cannot select a different country.
  if (candidate && d3.geoContains(candidate,location)) return candidate;
  if (id || pickPixels[offset+3]) return features.find(feature => d3.geoContains(feature,location)) ?? null;
  return null;
}
function checkHover() {
  if (!lastPointer || state.dragging || keyboardMoving || globeFocus) return;
  clearTimeout(tooltipHideTimer);
  if (inTooltipBridge(lastPointer)) return;
  const feature = featureAt(lastPointer);
  if (feature) showTooltip(feature,lastPointer); else hideTooltip();
}

function selectCountry(feature, event) {
  if (!feature) {hideTooltip();return;}
  showTooltip(feature,event);
  state.selected = feature;
  lastPointer = null;
  $('announcer').textContent = `${nameOf(feature)}, ${state.year}. ${comparisonText(feature.properties.code)}`;
}

function nearestSelectableYear(year) {
  // The sorted list keeps the earlier year when distances are equal.
  return selectableYears.reduce((nearest,candidate)=>
    Math.abs(candidate-year)<Math.abs(nearest-year)?candidate:nearest
  );
}

function updateYearControl(year) {
  $('year-slider').value=year;
  $('year-slider').setAttribute('aria-valuetext',String(year));
  $('year-value').value=year;
}

function queueSliderYear(year) {
  // Snap the thumb and readout immediately; coalesce the texture redraw.
  updateYearControl(year);
  if (sliderFrame !== null) cancelAnimationFrame(sliderFrame);
  sliderFrame=requestAnimationFrame(()=>setYear(year));
}

function setYear(year) {
  if (sliderFrame !== null) {cancelAnimationFrame(sliderFrame);sliderFrame=null;}
  const index = selectableYears.indexOf(Number(year));
  if (index === -1) return;
  if(plotZoomCode!==null)resetPlotZoom();
  state.year = selectableYears[index];
  updateYearControl(state.year);
  updateRelationship();
  drawTexture();
  if (state.hovered) {
    tooltip.innerHTML = tooltipHTML(state.hovered);
    positionTooltip();
  }
  $('announcer').textContent = `Showing ${matchedPoints.length} exact country-and-year matches from ${state.year} only.`;
}

function updateRelationship() {
  matchedPoints=pointsForYear(state.year);
  relationshipStats=relationshipChart.setData(matchedPoints,{year:state.year,xMax:chartXMax});
  relationshipChart.highlight(state.hovered?.properties.code ?? null);
  const {n,r}=relationshipStats;
  const coefficient=r===null?'unavailable':`${r>=0?'+':''}${r.toFixed(2)}`;
  let finding;
  if(n<3 || r===null) finding='There are too few varying matched observations to assess the relationship.';
  else if(Math.abs(r)<.2) finding='There is little linear association between schooling and literacy in the available data.';
  else finding=`Countries with more schooling tend to have ${r>0?'higher':'lower'} literacy rates.`;
  $('relationship-summary').textContent=`${finding} ${state.year}: ${n} matched countries; Pearson r = ${coefficient}.`;
  $('chart-year').textContent=state.year;
  $('sample-note').textContent=`Only exact country–year matches · Each country has equal weight${relationshipStats.slope!==null?' · Dashed line: linear trend':''}`;
  const projected=state.year>=schoolingData.source.projectionStartYear;
  $('schooling-status').classList.toggle('projection',projected);
  $('schooling-status').textContent=projected
    ?`${state.year} schooling values are projections based on 2010. Literacy values are from ${state.year}; neither series is filled from another year.`
    :`${state.year} schooling values are historical estimates. Both measures use the exact selected year; no missing observations are filled.`;
}

function requestRender() {
  if (!frameRequested) {frameRequested=true;requestAnimationFrame(render);}
}
function render(time) {
  frameRequested = false;
  const elapsed=lastFrameTime===null?1/60:Math.min((time-lastFrameTime)/1000,.05);
  lastFrameTime=time;
  if (globeFocus) {
    const target=globeFocus;
    const offset=camera.position.clone().sub(controls.target);
    const distance=offset.length(), direction=offset.normalize();
    const alpha=1-Math.exp(-9*elapsed);
    const rotation=new THREE.Quaternion().setFromUnitVectors(direction,target.direction);
    const step=new THREE.Quaternion().slerp(rotation,alpha);
    direction.applyQuaternion(step).normalize();
    let nextDistance=THREE.MathUtils.lerp(distance,target.distance,alpha);
    if (direction.angleTo(target.direction)<.001 && Math.abs(nextDistance-target.distance)<.001) {
      direction.copy(target.direction);nextDistance=target.distance;
      globeFocus=null;
    }
    camera.position.copy(controls.target).addScaledVector(direction,nextDistance);
  }
  const changed = controls.update();
  renderer.render(scene,camera);
  if (changed && lastPointer && !state.dragging) checkHover();
  if (globeFocus || changed) requestRender();
}
function resize() {
  if (!renderer) return;
  const {width,height}=container.getBoundingClientRect();
  renderer.setSize(width,height,false); camera.aspect=width/height;
  // Keep the full sphere visible at every screen size.
  const baseFov = THREE.MathUtils.degToRad(42);
  camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(baseFov/2)/Math.min(1,camera.aspect)));
  camera.updateProjectionMatrix(); positionTooltip(); requestRender();
}

function initGlobe() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42,1,.01,50);
  camera.position.copy(latLonVector(62,24,DEFAULT_GLOBE_DISTANCE));
  renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0,0);
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera,renderer.domElement);
  controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.1;
  controls.minDistance=1.10;controls.maxDistance=5.8;
  controls.rotateSpeed=.55;controls.zoomSpeed=.65;
  controls.minPolarAngle=.07;controls.maxPolarAngle=Math.PI-.07;
  controls.addEventListener('change',requestRender);
  controls.addEventListener('start',hideTooltip);
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width=WIDTH;textureCanvas.height=HEIGHT;
  textureContext=textureCanvas.getContext('2d');
  texture=new THREE.CanvasTexture(textureCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  sphere = new THREE.Mesh(new THREE.SphereGeometry(1,128,96),new THREE.MeshBasicMaterial({map:texture}));
  scene.add(sphere);
  // A transparent edge shade gives the globe depth without obscuring the data palette.
  const shade=new THREE.Mesh(new THREE.SphereGeometry(1.001,96,64),new THREE.ShaderMaterial({
    vertexShader:'varying vec3 vViewNormal; void main(){ vViewNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:'varying vec3 vViewNormal; void main(){float edge=1.0-clamp(vViewNormal.z,0.0,1.0);gl_FragColor=vec4(0.10,0.23,0.30,pow(edge,3.0)*0.29);}',
    transparent:true,depthWrite:false
  }));
  scene.add(shade);
  const pickCanvas=document.createElement('canvas');pickCanvas.width=WIDTH;pickCanvas.height=HEIGHT;
  pickContext=pickCanvas.getContext('2d',{willReadFrequently:true});
  const projection=d3.geoEquirectangular().scale(WIDTH/(2*Math.PI)).translate([WIDTH/2,HEIGHT/2]).precision(.1);
  const path=d3.geoPath(projection);
  paths=features.map(feature=>new Path2D(path(feature)));
  paths.forEach((path,index)=>{const id=index+1;pickContext.fillStyle=`rgb(${id&255},${id>>8},0)`;pickContext.fill(path);});
  pickPixels=pickContext.getImageData(0,0,WIDTH,HEIGHT).data;
  let startPoint=null;
  renderer.domElement.addEventListener('pointerdown',event=>{
    startPoint={x:event.clientX,y:event.clientY};state.dragging=false;hideTooltip();
  });
  renderer.domElement.addEventListener('pointermove',event=>{
    if (startPoint && Math.hypot(event.clientX-startPoint.x,event.clientY-startPoint.y)>4) state.dragging=true;
    lastPointer={clientX:event.clientX,clientY:event.clientY};
    if (state.dragging) hideTooltip();else checkHover();
  });
  renderer.domElement.addEventListener('pointerup',event=>{
    if (!state.dragging && startPoint) {
      selectCountry(featureAt(event),event);
    }
    startPoint=null;state.dragging=false;
    if(event.pointerType==='touch')lastPointer=null;
  });
  renderer.domElement.addEventListener('pointerleave',event=>{
    lastPointer=null;
    if (!tooltip.contains(event.relatedTarget)) scheduleTooltipHide();
  });
  renderer.domElement.addEventListener('pointercancel',()=>{startPoint=null;state.dragging=false;hideTooltip();});
  window.addEventListener('pointerup',()=>{startPoint=null;state.dragging=false;});
  renderer.domElement.addEventListener('wheel',()=>{lastPointer=null;hideTooltip();},{passive:true});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();$('loading').hidden=false;$('loading').innerHTML='<div class="error-state">The graphics context was interrupted. <a href="./">Reload the globe</a> to continue.</div>';});
  container.addEventListener('keydown',event=>{
    const rotations={ArrowLeft:-.12,ArrowRight:.12};
    if(event.key in rotations || event.key==='ArrowUp' || event.key==='ArrowDown'){
      event.preventDefault();lastPointer=null;hideTooltip();keyboardMoving=true;
      const spherical=new THREE.Spherical().setFromVector3(camera.position);
      if(event.key in rotations)spherical.theta+=rotations[event.key];
      else spherical.phi=THREE.MathUtils.clamp(spherical.phi+(event.key==='ArrowUp'?-.1:.1),.08,Math.PI-.08);
      camera.position.setFromSpherical(spherical);controls.update();requestRender();keyboardMoving=false;
    }
    if(event.key==='+' || event.key==='='){event.preventDefault();zoom(.85);}
    if(event.key==='-'){event.preventDefault();zoom(1.15);}
    if(event.key==='Escape'){lastPointer=null;hideTooltip();}
  });
  new ResizeObserver(resize).observe(container);resize();
  $('loading').hidden=true;
}

function zoom(factor) {
  lastPointer=null;hideTooltip();
  camera.position.setLength(THREE.MathUtils.clamp(camera.position.length()*factor,controls.minDistance,controls.maxDistance));
  controls.update();requestRender();
}
function initRelationshipChart() {
  const selectPlotCountry=(point,event)=>{
    const feature=featureByCode.get(point.code);
    if (!feature) return;
    clearTimeout(plotZoomTimer);plotZoomTimer=null;
    plotZoomCode=point.code;
    plotZoomTouch=event.pointerType==='touch';
    selectCountry(feature,event);
    focusGlobe(feature);
  };
  relationshipChart=createRelationshipChart($('relationship-chart'),{
    onHover:selectPlotCountry,
    onLeave:leavePlotCountry,
    onSelect:selectPlotCountry
  });
  $('relationship-chart').addEventListener('pointermove',event=>{
    if(inTooltipBridge(event))clearTimeout(tooltipHideTimer);
    else if(!event.target.closest('.chart-point') && state.hovered)scheduleTooltipHide();
  });
  $('relationship-chart').addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      event.preventDefault();lastPointer=null;hideTooltip();
    }
  });
}
function initUI() {
  const slider=$('year-slider');
  // Position the thumb and every tick on the same calendar-year scale.
  slider.min=selectableYears[0];
  slider.max=selectableYears.at(-1);
  const span=Number(slider.max)-Number(slider.min);
  $('year-ticks').replaceChildren(...selectableYears.map(year=>{
    const tick=document.createElement('span');
    tick.className='year-tick';
    tick.textContent=year;
    tick.dataset.year=year;
    tick.style.setProperty('--position',`${span?100*(year-Number(slider.min))/span:0}%`);
    return tick;
  }));
  slider.disabled=selectableYears.length<2;
  slider.addEventListener('input',()=>{
    queueSliderYear(nearestSelectableYear(Number(slider.value)));
  });
  slider.addEventListener('change',()=>setYear(nearestSelectableYear(Number(slider.value))));
  slider.addEventListener('keydown',event=>{
    const index=selectableYears.indexOf(Number(slider.value));
    let target;
    switch(event.key){
      case 'ArrowRight': case 'ArrowUp': case 'PageUp': target=index+1; break;
      case 'ArrowLeft': case 'ArrowDown': case 'PageDown': target=index-1; break;
      case 'Home': target=0; break;
      case 'End': target=selectableYears.length-1; break;
      default: return;
    }
    event.preventDefault();
    queueSliderYear(selectableYears[Math.max(0,Math.min(selectableYears.length-1,target))]);
  });
  document.querySelector('.explorer').addEventListener('click',event=>{
    const button=event.target.closest('[data-comparison-code]');
    if (!button) return;
    const feature=features.find(feature=>feature.properties.code===button.dataset.comparisonCode);
    const year=nearestComparisonYear(button.dataset.comparisonCode);
    if (!feature || year===null) return;
    const fromYear=state.year;
    lastPointer=null;
    state.selected=feature;
    setYear(year);
    tooltip.focus({preventScroll:true});
    $('announcer').textContent=`Comparing ${nameOf(feature)} and China in ${year}, the closest shared year with both measures to ${fromYear}. ${nameOf(feature)}: ${pairedObservation(feature.properties.code).schooling.toFixed(2)} schooling years and ${formatRate(pairedObservation(feature.properties.code).literate)} literacy. China: ${pairedObservation('CHN').schooling.toFixed(2)} schooling years and ${formatRate(pairedObservation('CHN').literate)} literacy.`;
  });
  tooltip.addEventListener('pointerenter',()=>{lastPointer=null;clearTimeout(tooltipHideTimer);});
  tooltip.addEventListener('pointerleave',scheduleTooltipHide);
  tooltip.addEventListener('focusin',()=>clearTimeout(tooltipHideTimer));
  tooltip.addEventListener('focusout',scheduleTooltipHide);
  tooltip.addEventListener('keydown',event=>{
    if (event.key==='Escape') {hideTooltip();container.focus({preventScroll:true});}
  });
  setYear(selectableYears.includes(schoolingData.defaultYear)?schoolingData.defaultYear:selectableYears.at(-1));
}

async function main() {
  try{
    const responses=await Promise.all([fetch('./data/literacy.json'),fetch('./data/schooling.json'),fetch('./data/countries.geojson')]);
    if(responses.some(response=>!response.ok))throw new Error('The local data files could not be loaded.');
    [data,schoolingData,{features}]=await Promise.all(responses.map(response=>response.json()));
    if(!window.d3?.geoPath)throw new Error('The local geography library could not be loaded.');
    featureByCode=new Map(features.map(feature=>[feature.properties.code,feature]));
    // Preserve the China comparison while requiring an exact join in both datasets.
    selectableYears=[...new Set(data.availableYears)].filter(year=>
      pairedObservation('CHN',year) && pointsForYear(year).length>=3
    ).sort((a,b)=>a-b);
    if(!selectableYears.length){
      $('year-value').value='—';
      $('year-ticks').replaceChildren();
      $('loading').textContent='No years have matching schooling and literacy observations that can be compared with China.';
      $('relationship-summary').textContent='No exact country-and-year matches are available.';
      return;
    }
    const allPoints=selectableYears.flatMap(year=>pointsForYear(year));
    chartXMax=Math.max(2,Math.ceil(Math.max(...allPoints.map(point=>point.schooling))/2)*2);
    initRelationshipChart();initGlobe();initUI();
    // Read-only state for export and reproducible browser validation.
    window.literacyAtlas={get year(){return state.year;},get selectableYears(){return [...selectableYears];},get selectedCountry(){return state.selected?.properties.code??null;},get hoveredCountry(){return state.hovered?.properties.code??null;},get globeView(){const offset=camera.position.clone().sub(controls.target),direction=offset.clone().normalize();return {longitude:THREE.MathUtils.radToDeg(Math.atan2(-direction.z,direction.x)),latitude:THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.y,-1,1))),distance:offset.length(),animating:globeFocus!==null};},get data(){return data;},get schoolingData(){return schoolingData;},get features(){return features;},get points(){return matchedPoints.map(point=>({...point}));},get relationship(){return relationshipStats?{...relationshipStats}:null;},observation,schoolingObservation,pairedObservation,literacyColor};
  }catch(error){
    console.error('Literacy Atlas:',error);
    $('loading').hidden=false;
    $('loading').innerHTML='<div class="error-state">The visualization needs WebGL and a local web server.<br><a href="./">Reload</a></div>';
    $('relationship-summary').textContent='The matched observations could not be loaded.';
  }
}
main();

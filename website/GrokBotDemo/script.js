const SHAPES = {
  blob: 'M180 48 C232 48 281 76 300 120 C321 168 305 234 267 274 C228 315 164 322 111 295 C61 270 41 220 52 164 C63 101 111 48 180 48 Z',
  pebble: 'M180 48 C244 48 296 94 300 157 C304 219 263 292 198 304 C132 316 62 276 50 211 C37 143 74 83 132 57 C147 50 163 48 180 48 Z',
  bean: 'M136 54 C205 22 277 64 297 128 C316 188 284 270 225 298 C172 322 86 295 61 232 C37 171 61 91 136 54 Z',
  capsule: 'M121 50 C84 50 55 78 55 115 L55 245 C55 282 84 310 121 310 L239 310 C276 310 305 282 305 245 L305 115 C305 78 276 50 239 50 Z',
  hex: 'M119 48 L241 48 L301 111 L277 246 L180 310 L83 246 L59 111 Z',
  leaf: 'M180 43 C226 67 284 92 302 145 C322 204 281 269 223 302 C171 332 101 302 70 249 C39 197 54 125 103 84 C128 64 154 51 180 43 Z',
};

const STATES = {
  idle: { label: 'Idle', readout: 'ready / watching', description: 'A quiet baseline. The bot keeps watch and changes expression on a slow rhythm.', expressions: ['neutral', 'soft'] },
  listening: { label: 'Listening', readout: 'input / attentive', description: 'Eyes open wider and settle toward the next signal.', expressions: ['wide', 'soft'] },
  thinking: { label: 'Thinking', readout: 'compute / considering', description: 'A slower, focused face for the space between request and answer.', expressions: ['focused', 'soft'] },
  working: { label: 'Working', readout: 'runtime / active', description: 'The body breathes while a task is in motion.', expressions: ['focused', 'wide'] },
  happy: { label: 'Happy', readout: 'result / positive', description: 'A short lift after a useful turn, then back to the active state.', expressions: ['happy', 'soft'] },
  surprised: { label: 'Surprised', readout: 'event / unexpected', description: 'A compact reaction for a new message or a sharp change of context.', expressions: ['wide', 'surprised'] },
  alerting: { label: 'Alerting', readout: 'attention / needed', description: 'The bot asks for a second look without turning the whole interface red.', expressions: ['alert', 'wide'] },
};

const EXPRESSIONS = {
  neutral: { left: [1, 1, 0], right: [1, 1, 0], mouth: 'M 158 215 Q 180 229 202 215', mouthOpacity: 0.66 },
  soft: { left: [0.9, 0.82, -6], right: [0.9, 0.82, 6], mouth: 'M 157 216 Q 180 236 203 216', mouthOpacity: 0.9 },
  focused: { left: [0.72, 0.46, -1], right: [0.72, 0.46, 1], mouth: 'M 162 222 Q 180 218 198 222', mouthOpacity: 0.72 },
  wide: { left: [1.08, 1.14, -2], right: [1.08, 1.14, 2], mouth: 'M 162 212 Q 180 242 198 212', mouthOpacity: 1 },
  happy: { left: [0.96, 0.56, 0], right: [0.96, 0.56, 0], mouth: 'M 155 211 Q 180 246 205 211', mouthOpacity: 1 },
  surprised: { left: [1.08, 1.12, 0], right: [1.08, 1.12, 0], mouth: 'M 180 211 a 15 20 0 1 0 0.1 0', mouthOpacity: 1 },
  alert: { left: [0.85, 0.86, -10], right: [0.85, 0.86, 10], mouth: 'M 160 230 Q 180 213 200 230', mouthOpacity: 0.9 },
};

const stateKeys = Object.keys(STATES);
const shapeKeys = Object.keys(SHAPES);
const model = { state: 'idle', shape: 'blob', gazeX: 0, gazeY: 0, turn: 0, auto: false, expressionIndex: 0, blinking: false };
const refs = {
  avatarStage: document.querySelector('#avatarStage'),
  bodyPath: document.querySelector('#bodyPath'),
  faceGroup: document.querySelector('#faceGroup'),
  bodyGroup: document.querySelector('#bodyGroup'),
  botAvatar: document.querySelector('#botAvatar'),
  eyeLeft: document.querySelector('#eyeLeft'),
  eyeRight: document.querySelector('#eyeRight'),
  mouthPath: document.querySelector('#mouthPath'),
  stateTitle: document.querySelector('#stateTitle'),
  stateReadout: document.querySelector('#stateReadout'),
  stateDescription: document.querySelector('#stateDescription'),
  stateIndex: document.querySelector('#stateIndex'),
  statusDot: document.querySelector('#statusDot'),
  stateOptions: document.querySelector('#stateOptions'),
  shapeOptions: document.querySelector('#shapeOptions'),
  shapeValue: document.querySelector('#shapeValue'),
  gazeX: document.querySelector('#gazeX'),
  gazeY: document.querySelector('#gazeY'),
  turnRange: document.querySelector('#turnRange'),
  gazeValue: document.querySelector('#gazeValue'),
  turnValue: document.querySelector('#turnValue'),
  gazeReadoutX: document.querySelector('#gazeReadoutX'),
  turnReadout: document.querySelector('#turnReadout'),
  eventPulse: document.querySelector('#eventPulse'),
  eventLog: document.querySelector('#eventLog'),
};

function signed(value, digits = 2) {
  const fixed = Number(value).toFixed(digits);
  return Number(value) >= 0 ? `+${fixed}` : fixed;
}

function timeStamp() {
  return new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
}

function logEvent(message) {
  const item = document.createElement('li');
  item.innerHTML = `<time>${timeStamp()}</time><strong>${message}</strong>`;
  refs.eventLog.prepend(item);
  while (refs.eventLog.children.length > 4) refs.eventLog.lastElementChild.remove();
  refs.eventPulse.textContent = message;
}

function renderButtons() {
  refs.stateOptions.innerHTML = stateKeys.map((key) => `<button class="chip${model.state === key ? ' active' : ''}" type="button" data-state="${key}">${STATES[key].label}</button>`).join('');
  refs.shapeOptions.innerHTML = shapeKeys.map((key) => `<button class="chip${model.shape === key ? ' active' : ''}" type="button" data-shape="${key}">${key}</button>`).join('');
  refs.stateOptions.querySelectorAll('[data-state]').forEach((button) => button.addEventListener('click', () => setState(button.dataset.state, true)));
  refs.shapeOptions.querySelectorAll('[data-shape]').forEach((button) => button.addEventListener('click', () => setShape(button.dataset.shape)));
}

function renderAvatar() {
  const state = STATES[model.state];
  const expressionKey = state.expressions[model.expressionIndex % state.expressions.length];
  const expression = EXPRESSIONS[expressionKey];
  const turnFactor = Math.cos((model.turn * Math.PI) / 180);
  const bodyScale = 0.91 + turnFactor * 0.09;
  const faceX = model.gazeX * 13 + model.turn * 0.18;
  const faceY = model.gazeY * 9;

  refs.bodyPath.setAttribute('d', SHAPES[model.shape]);
  refs.bodyGroup.setAttribute('transform', `translate(180 180) scale(${bodyScale.toFixed(3)} 1) translate(-180 -180)`);
  refs.faceGroup.setAttribute('transform', `translate(${faceX.toFixed(2)} ${faceY.toFixed(2)})`);
  refs.eyeLeft.setAttribute('rx', (24 * expression.left[0]).toFixed(2));
  refs.eyeLeft.setAttribute('ry', (31 * expression.left[1]).toFixed(2));
  refs.eyeRight.setAttribute('rx', (24 * expression.right[0]).toFixed(2));
  refs.eyeRight.setAttribute('ry', (31 * expression.right[1]).toFixed(2));
  refs.eyeLeft.setAttribute('transform', `rotate(${expression.left[2]} 140 153)`);
  refs.eyeRight.setAttribute('transform', `rotate(${expression.right[2]} 220 153)`);
  refs.mouthPath.setAttribute('d', expression.mouth);
  refs.mouthPath.style.opacity = expression.mouthOpacity;

  refs.botAvatar.classList.toggle('working', model.state === 'working' || model.state === 'thinking');
  refs.botAvatar.classList.toggle('blinking', model.blinking);
  refs.stateTitle.textContent = state.label;
  refs.stateReadout.textContent = state.readout;
  refs.stateDescription.textContent = state.description;
  refs.stateIndex.textContent = String(stateKeys.indexOf(model.state) + 1).padStart(2, '0');
  refs.statusDot.classList.toggle('busy', ['thinking', 'working', 'alerting'].includes(model.state));
  refs.shapeValue.textContent = model.shape;
  refs.gazeValue.textContent = `${Number(model.gazeX).toFixed(2)} / ${Number(model.gazeY).toFixed(2)}`;
  refs.turnValue.textContent = `${model.turn}°`;
  refs.gazeReadoutX.textContent = signed(model.gazeX);
  refs.turnReadout.textContent = `${model.turn}°`;
}

function setState(next, shouldLog = false) {
  if (!STATES[next]) return;
  model.state = next;
  model.expressionIndex = 0;
  renderButtons();
  renderAvatar();
  if (shouldLog) logEvent(`state → ${STATES[next].label.toLowerCase()}`);
}

function setShape(next) {
  if (!SHAPES[next]) return;
  model.shape = next;
  renderButtons();
  renderAvatar();
  logEvent(`shape → ${next}`);
}

function blink() {
  model.blinking = true;
  renderAvatar();
  logEvent('controller.blink()');
  window.setTimeout(() => {
    model.blinking = false;
    renderAvatar();
  }, 320);
}

function spin() {
  refs.botAvatar.classList.remove('spinning');
  void refs.botAvatar.offsetWidth;
  refs.botAvatar.classList.add('spinning');
  logEvent('controller.spin()');
  window.setTimeout(() => refs.botAvatar.classList.remove('spinning'), 920);
}

function reset() {
  model.state = 'idle';
  model.shape = 'blob';
  model.gazeX = 0;
  model.gazeY = 0;
  model.turn = 0;
  model.expressionIndex = 0;
  refs.gazeX.value = '0';
  refs.gazeY.value = '0';
  refs.turnRange.value = '0';
  renderButtons();
  renderAvatar();
  logEvent('controller.reset()');
}

function advanceExpression() {
  model.expressionIndex += 1;
  renderAvatar();
  logEvent(`expression → ${STATES[model.state].expressions[model.expressionIndex % STATES[model.state].expressions.length]}`);
}

refs.gazeX.addEventListener('input', (event) => { model.gazeX = Number(event.target.value); renderAvatar(); });
refs.gazeY.addEventListener('input', (event) => { model.gazeY = Number(event.target.value); renderAvatar(); });
refs.turnRange.addEventListener('input', (event) => { model.turn = Number(event.target.value); renderAvatar(); });
document.querySelector('#blinkButton').addEventListener('click', blink);
document.querySelector('#spinButton').addEventListener('click', spin);
document.querySelector('#resetButton').addEventListener('click', reset);
document.querySelector('#avatarButton').addEventListener('click', blink);
document.querySelector('#clearLog').addEventListener('click', () => { refs.eventLog.innerHTML = ''; refs.eventPulse.textContent = 'controller idle'; });
document.querySelector('#autoExpression').addEventListener('change', (event) => {
  model.auto = event.target.checked;
  logEvent(`autoExpression → ${model.auto ? 'on' : 'off'}`);
});

const autoTimer = window.setInterval(() => {
  if (model.auto) advanceExpression();
}, 4200);
window.addEventListener('beforeunload', () => window.clearInterval(autoTimer));

refs.avatarStage.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  const rect = refs.avatarStage.getBoundingClientRect();
  model.gazeX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
  model.gazeY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
  refs.gazeX.value = model.gazeX.toFixed(2);
  refs.gazeY.value = model.gazeY.toFixed(2);
  renderAvatar();
});
refs.avatarStage.addEventListener('pointerleave', () => {
  model.gazeX = 0;
  model.gazeY = 0;
  refs.gazeX.value = '0';
  refs.gazeY.value = '0';
  renderAvatar();
});

renderButtons();
renderAvatar();
logEvent('widget mounted');

// ============================================================
//  GENESIS — Backend Tick Runner
//  GitHub Action: s'exécute toutes les 5 minutes
//  - Lit l'état depuis Supabase
//  - Fait avancer la simulation (N ticks)
//  - Appelle Gemini si événement notable
//  - Écrit le nouvel état dans Supabase
// ============================================================

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;

const TICKS_PER_RUN   = 60; // ~1 journée de jeu par run (chaque tick = 1 jour)

// ── Supabase fetch helpers ───────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
  });
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  return r;
}

async function sbInsert(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  return r;
}

// ── Gemini IA ────────────────────────────────────────────────
async function callGemini(prompt) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, temperature: 0.9 }
        })
      }
    );
    const data = await r.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error('Gemini error:', e.message);
    return null;
  }
}

// ── Moteur de simulation (Node.js) ──────────────────────────

const WORLD_W = 80, WORLD_H = 50;
const TILE = { WATER:0, GRASS:1, FOREST:2, MOUNTAIN:3, FARM:4, VILLAGE:5, CITY:6, MINE:7, ROAD:8 };
const TRAITS = ['brave','lazy','curious','aggressive','kind','greedy','creative','spiritual'];
const ERA = ['prehistoric','ancient','medieval','renaissance','industrial','modern'];

function rng(seed) {
  // Simple seeded random (xorshift)
  let s = seed ^ 0xdeadbeef;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
}

function generateWorld(seed = 42) {
  const r = rng(seed);
  const map = [];
  for (let y = 0; y < WORLD_H; y++) {
    map[y] = [];
    for (let x = 0; x < WORLD_W; x++) {
      const n = Math.sin(x * 0.15 + seed) * Math.cos(y * 0.12) +
                Math.sin(x * 0.07 + 1.3) * Math.cos(y * 0.09 + 0.7) +
                Math.sin(x * 0.03 + y * 0.04) * 0.5;
      const v = (n + 2) / 4;
      if (v < 0.28)      map[y][x] = TILE.WATER;
      else if (v < 0.55) map[y][x] = TILE.GRASS;
      else if (v < 0.72) map[y][x] = TILE.FOREST;
      else               map[y][x] = TILE.MOUNTAIN;
    }
  }
  return map;
}

function initState() {
  console.log('🌍 Initialisation du monde Genesis...');
  const world = generateWorld(12345);
  const state = {
    world,
    humans: [],
    resources: { food:500, wood:300, stone:200, gold:0, iron:0, knowledge:0 },
    era: 0, year: 0, day: 0,
    births: 0, deaths: 0,
    population: 0,
    discoveries: ['fire','language'],
    tickCount: 0,
    worldSeed: 12345
  };
  spawnHuman(state, 'Adam', 'M', 25, 35, 25);
  spawnHuman(state, 'Eve', 'F', 27, 27, 25);
  return state;
}

function spawnHuman(state, name, sex, x, y, age = 18) {
  const traits = [];
  const pool = [...TRAITS];
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    traits.push(pool.splice(idx, 1)[0]);
  }
  const h = {
    id: Date.now() + Math.random(),
    name, sex, x, y, age,
    alive: true,
    pregnant: false, pregnancyDays: 0,
    partner: null, children: [],
    traits,
    skills: { farming:1, building:1, combat:1, crafting:1, medicine:1, trading:1 },
    inventory: { food:5, wood:2, stone:1, gold:0, iron:0, knowledge:0 },
    action: 'idle', actionTimer: 0,
    age_days: age * 365,
    hunger: 100, energy: 100, health: 100, social: 50
  };
  state.humans.push(h);
  state.population++;
  return h;
}

function tick(state, newEvents) {
  state.tickCount++;
  state.day++;
  if (state.day >= 365) { state.day = 0; state.year++; onNewYear(state, newEvents); }

  const alive = state.humans.filter(h => h.alive);

  for (const h of alive) {
    updateNeeds(state, h);
    updateAction(state, h, alive);
    checkReproduction(state, h, alive, newEvents);
    checkDeath(state, h, newEvents);
  }

  for (const h of alive.filter(h => h.pregnant)) {
    h.pregnancyDays++;
    if (h.pregnancyDays >= 280) giveBirth(state, h, alive, newEvents);
  }

  updateResources(state);
  checkDiscoveries(state, newEvents);
  checkEraProgression(state, newEvents);
  state.population = state.humans.filter(h => h.alive).length;
}

function updateNeeds(state, h) {
  h.hunger  -= 0.3;
  h.energy  -= 0.2;
  h.social  -= 0.05;
  h.age_days += 1;

  if (h.hunger < 0)  { h.hunger = 0; h.health -= 1; }
  if (h.energy < 0)   h.energy = 0;

  if (h.hunger < 30 && h.inventory.food > 0) {
    h.inventory.food--;
    h.hunger = Math.min(100, h.hunger + 30);
  } else if (h.hunger < 30 && state.resources.food > 0) {
    state.resources.food--;
    h.hunger = Math.min(100, h.hunger + 25);
  }

  if (h.energy < 20 && h.action !== 'sleeping') {
    h.action = 'sleeping'; h.actionTimer = 30;
  }
  if (h.action === 'sleeping') {
    h.energy = Math.min(100, h.energy + 2);
    if (h.energy >= 80) h.action = 'idle';
  }
}

function updateAction(state, h, alive) {
  if (h.action === 'sleeping') return;
  if (h.actionTimer > 0) { h.actionTimer--; return; }

  const dec = decideAction(state, h, alive);
  h.action = dec.action; h.actionTimer = dec.duration;

  switch (h.action) {
    case 'gather_food':
      const food = 2 + Math.floor(Math.random() * 3) + (h.skills.farming > 3 ? 2 : 0);
      h.inventory.food += food; state.resources.food += Math.floor(food / 2);
      h.skills.farming = Math.min(10, h.skills.farming + 0.01);
      break;
    case 'chop_wood':
      const wood = 1 + Math.floor(Math.random() * 2);
      h.inventory.wood += wood; state.resources.wood += wood;
      break;
    case 'farm':
      if (state.discoveries.includes('agriculture')) {
        const yield_ = 3 + Math.floor(h.skills.farming);
        h.inventory.food += yield_; state.resources.food += yield_;
        h.skills.farming = Math.min(10, h.skills.farming + 0.05);
      }
      break;
    case 'mine':
      if (state.discoveries.includes('mining')) {
        state.resources.stone += 1;
        if (Math.random() < 0.3) state.resources.iron += 1;
      }
      break;
    case 'build':
      buildStructure(state, h);
      break;
    case 'socialize':
      h.social = Math.min(100, h.social + 20);
      break;
    case 'explore':
      moveRandom(state, h);
      if (h.traits.includes('curious')) state.resources.knowledge += 0.1;
      break;
    case 'trade':
      if (state.discoveries.includes('trade') && alive.length > 1) {
        const partner = alive.find(o => o.id !== h.id && o.inventory.food > 5);
        if (partner && h.inventory.wood > 2) {
          partner.inventory.food -= 3; h.inventory.food += 3;
          h.inventory.wood -= 2; partner.inventory.wood += 2;
        }
      }
      break;
  }
}

function decideAction(state, h, alive) {
  if (h.hunger < 40) return { action: 'gather_food', duration: 20 };
  if (h.energy < 30) return { action: 'sleeping', duration: 40 };
  if (h.social < 20 && alive.length > 1) return { action: 'socialize', duration: 15 };
  const r = Math.random();
  if (h.traits.includes('curious') && r < 0.3) return { action: 'explore', duration: 25 };
  if (h.traits.includes('creative') && state.resources.wood > 10 && r < 0.4) return { action: 'build', duration: 50 };
  if (state.era >= 1 && state.discoveries.includes('agriculture') && r < 0.4) return { action: 'farm', duration: 30 };
  if (state.era >= 2 && state.discoveries.includes('mining') && r < 0.2) return { action: 'mine', duration: 40 };
  const actions = ['gather_food','chop_wood','explore','socialize'];
  return { action: actions[Math.floor(Math.random() * actions.length)], duration: 15 + Math.floor(Math.random() * 20) };
}

function checkReproduction(state, h, alive, newEvents) {
  if (!h.alive || h.pregnant) return;
  const age = h.age_days / 365;
  if (age < 16 || age > 45) return;
  if (h.hunger < 30 || h.health < 40) return;
  const partners = alive.filter(o =>
    o.id !== h.id && o.alive && !o.pregnant && o.sex !== h.sex &&
    Math.abs(o.age_days - h.age_days) / 365 < 15 &&
    Math.hypot(o.x - h.x, o.y - h.y) < 8 && o.hunger > 30
  );
  if (!partners.length) return;
  const partner = partners[Math.floor(Math.random() * partners.length)];
  const attraction = 0.001 + (h.social > 60 ? 0.002 : 0) + (alive.length < 10 ? 0.003 : 0);
  if (Math.random() < attraction) {
    if (h.sex === 'F') {
      h.pregnant = true; h.pregnancyDays = 0; h.partner = partner.id;
      newEvents.push({ msg: `💑 ${h.name} et ${partner.name} forment un couple. ${h.name} est enceinte !`, type: 'birth', year: state.year, day: state.day });
    } else {
      partner.pregnant = true; partner.pregnancyDays = 0; partner.partner = h.id;
      newEvents.push({ msg: `💑 ${h.name} et ${partner.name} forment un couple. ${partner.name} est enceinte !`, type: 'birth', year: state.year, day: state.day });
    }
  }
}

function giveBirth(state, mother, alive, newEvents) {
  mother.pregnant = false; mother.pregnancyDays = 0;
  const sex = Math.random() < 0.5 ? 'M' : 'F';
  const pool = sex === 'M'
    ? ['Caïn','Abel','Seth','Noah','Luca','Hugo','Max','Leo','Théo','Jules','Tom','Enzo','Axel','Ethan','Nathan','Sasha','Robin','Louis','Rémi','Pierre']
    : ['Lila','Sara','Nina','Mia','Eva','Léa','Clara','Emma','Lucie','Alice','Camille','Chloé','Inès','Jade','Louise','Manon','Mathilde','Pauline','Sofia','Zoé'];
  const name = pool[Math.floor(Math.random() * pool.length)];
  const child = spawnHuman(state, name, sex, mother.x + Math.floor(Math.random()*3-1), mother.y + Math.floor(Math.random()*3-1), 0);
  child.age_days = 0;
  mother.children.push(child.id);
  state.births++;
  newEvents.push({ msg: `👶 ${mother.name} donne naissance à ${name} ! Population: ${state.population}`, type: 'birth', year: state.year, day: state.day });
}

function checkDeath(state, h, newEvents) {
  if (!h.alive) return;
  const age = h.age_days / 365;
  const maxAge = 50 + Math.floor(Math.random() * 30) + (state.era * 5) + (state.discoveries.includes('medicine') ? 15 : 0);
  if (age > maxAge) { killHuman(state, h, 'vieillesse', newEvents); return; }
  if (h.health <= 0) { killHuman(state, h, 'famine', newEvents); return; }
  const deathChance = 0.00003 * (age > 60 ? 5 : 1) * (h.health < 30 ? 3 : 1);
  if (Math.random() < deathChance) {
    const causes = ['maladie','accident','noyade','tempête'];
    killHuman(state, h, causes[Math.floor(Math.random() * causes.length)], newEvents);
  }
}

function killHuman(state, h, cause, newEvents) {
  h.alive = false; state.deaths++;
  state.population = state.humans.filter(h => h.alive).length;
  const age = Math.floor(h.age_days / 365);
  newEvents.push({ msg: `💀 ${h.name} est mort(e) à ${age} ans (${cause}). Population: ${state.population}`, type: 'death', year: state.year, day: state.day });
}

function updateResources(state) {
  state.resources.food = Math.max(0, state.resources.food - 0.1 * state.population);
  const farms = state.humans.filter(h => h.alive && h.action === 'farm').length;
  state.resources.food += farms * 0.5;
}

function checkDiscoveries(state, newEvents) {
  const k = state.resources.knowledge, pop = state.population;
  const checks = [
    { id:'agriculture', cond: k > 20 || pop > 5,                               msg:'🌾 Agriculture découverte ! Les humains cultivent la terre.' },
    { id:'construction', cond: state.resources.wood > 50,                       msg:'🏠 Construction maîtrisée ! Les premiers abris solides émergent.' },
    { id:'trade',       cond: pop > 6,                                           msg:'🤝 Commerce inventé ! Les échanges commencent entre familles.' },
    { id:'writing',     cond: k > 80,                                            msg:'✍️ Écriture inventée ! La connaissance peut se transmettre.' },
    { id:'mining',      cond: state.resources.stone > 100,                       msg:'⛏️ Exploitation minière découverte !' },
    { id:'medicine',    cond: k > 150,                                           msg:'💊 Médecine développée ! L\'espérance de vie augmente.' },
    { id:'metalwork',   cond: state.resources.iron > 30,                         msg:'⚔️ Travail du métal maîtrisé !' },
    { id:'wheel',       cond: k > 50 && state.resources.wood > 100,              msg:'🎡 La roue inventée !' },
    { id:'currency',    cond: state.resources.gold > 20 && pop > 15,             msg:'💰 Monnaie inventée ! L\'économie s\'organise.' },
    { id:'printing',    cond: k > 300,                                           msg:'📖 Imprimerie inventée !' },
    { id:'steam_engine',cond: state.resources.iron > 200 && k > 500,            msg:'⚙️ Machine à vapeur inventée ! La révolution industrielle commence !' },
    { id:'electricity', cond: k > 800 && state.era >= 4,                        msg:'⚡ Électricité maîtrisée ! L\'ère moderne commence.' },
  ];
  for (const c of checks) {
    if (!state.discoveries.includes(c.id) && c.cond) {
      state.discoveries.push(c.id);
      state.resources.knowledge += 50;
      newEvents.push({ msg: c.msg, type: 'discovery', year: state.year, day: state.day, notable: true });
    }
  }
}

function checkEraProgression(state, newEvents) {
  const ERA_NAMES = ['Préhistoire','Antiquité','Moyen-Âge','Renaissance','Ère Industrielle','Ère Moderne'];
  const thresholds = [
    { era:1, cond: state.population >= 5 && state.discoveries.includes('agriculture') },
    { era:2, cond: state.population >= 15 && state.discoveries.includes('trade') },
    { era:3, cond: state.population >= 30 && state.discoveries.includes('writing') },
    { era:4, cond: state.population >= 50 && state.discoveries.includes('printing') },
    { era:5, cond: state.population >= 80 && state.discoveries.includes('steam_engine') },
  ];
  for (const t of thresholds) {
    if (state.era < t.era && t.cond) {
      state.era = t.era;
      newEvents.push({ msg: `🏛️ Nouvelle ère : ${ERA_NAMES[t.era].toUpperCase()} ! (An ${state.year})`, type: 'era', year: state.year, day: state.day, notable: true });
    }
  }
}

function onNewYear(state, newEvents) {
  if (state.year % 10 === 0) {
    newEvents.push({ msg: `📅 An ${state.year} — Population: ${state.population} | Ère: ${ERA[state.era]}`, type: 'year', year: state.year, day: state.day });
  }
  const evts = [
    { chance:0.05, msg:'🌊 Inondation ! Les récoltes sont perdues.',        fn: () => { state.resources.food = Math.max(0, state.resources.food - 100); } },
    { chance:0.03, msg:'🔥 Incendie dans la forêt ! Le bois manque.',       fn: () => { state.resources.wood = Math.max(0, state.resources.wood - 80); } },
    { chance:0.04, msg:'☀️ Excellente récolte cette année !',               fn: () => { state.resources.food += 200; } },
    { chance:0.03, msg:'🌿 Un guérisseur découvre une plante médicinale.',  fn: () => { state.resources.knowledge += 20; } },
  ];
  for (const e of evts) {
    if (Math.random() < e.chance) {
      newEvents.push({ msg: e.msg, type: 'event', year: state.year, day: state.day });
      e.fn();
    }
  }
}

function moveRandom(state, h) {
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const [dx,dy] = dirs[Math.floor(Math.random()*4)];
  const nx = Math.max(0, Math.min(WORLD_W-1, h.x+dx));
  const ny = Math.max(0, Math.min(WORLD_H-1, h.y+dy));
  if (state.world[ny][nx] !== TILE.WATER) { h.x = nx; h.y = ny; }
}

function buildStructure(state, h) {
  if (state.resources.wood < 5) return;
  state.resources.wood -= 5;
  const type = state.population > 20 && state.discoveries.includes('trade') ? TILE.CITY
    : state.population > 8 ? TILE.VILLAGE : TILE.ROAD;
  if (state.world[h.y][h.x] !== TILE.WATER) state.world[h.y][h.x] = type;
  h.skills.building = Math.min(10, h.skills.building + 0.1);
}

// ── Actions dieu (visiteurs) ──────────────────────────────────
function applyGodAction(state, action, newEvents) {
  switch (action) {
    case 'food':
      state.resources.food += 150;
      newEvents.push({ msg: '🎁 Un dieu bienveillant envoie de la nourriture ! La famine est évitée.', type: 'event', year: state.year, day: state.day });
      break;
    case 'knowledge':
      state.resources.knowledge += 80;
      newEvents.push({ msg: '💡 Une révélation divine illumine les esprits ! Le savoir progresse.', type: 'event', year: state.year, day: state.day });
      break;
    case 'disaster':
      state.resources.food = Math.max(0, state.resources.food - 250);
      newEvents.push({ msg: '⚡ La colère divine frappe ! Une catastrophe ravage les réserves.', type: 'event', year: state.year, day: state.day });
      break;
    case 'plague': {
      const alive = state.humans.filter(h => h.alive);
      alive.forEach(h => { h.health -= 20 + Math.floor(Math.random() * 30); });
      newEvents.push({ msg: '🦠 Une épidémie se répand ! Les humains souffrent.', type: 'death', year: state.year, day: state.day });
      break;
    }
    case 'gold':
      state.resources.gold += 60;
      newEvents.push({ msg: '✨ De l\'or apparaît du néant ! Les richesses s\'accumulent.', type: 'event', year: state.year, day: state.day });
      break;
  }
}

// ── Gemini: générer un commentaire narratif ──────────────────
async function generateAINarrative(state, notableEvents) {
  if (!GEMINI_API_KEY || notableEvents.length === 0) return null;

  const ERA_NAMES = ['Préhistoire','Antiquité','Moyen-Âge','Renaissance','Ère Industrielle','Ère Moderne'];
  const era = ERA_NAMES[state.era];
  const pop = state.population;
  const events = notableEvents.map(e => e.msg).join('\n');

  const prompt = `Tu es le narrateur d'une simulation de civilisation appelée Genesis.
Contexte : An ${state.year}, Ère ${era}, Population ${pop} humains.
Événements récents :
${events}

En 1-2 phrases maximum, écris une chronique épique et poétique en français sur ces événements. 
Style biblique/épique. Commence par "📜" suivi de la chronique. Sois bref et percutant.`;

  return callGemini(prompt);
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Genesis Tick Runner démarré');

  // 1. Lire l'état actuel
  const rows = await sbGet('world_state?id=eq.1&select=state,tick');
  let worldState = rows[0]?.state;
  const currentTick = rows[0]?.tick || 0;

  // 2. Initialiser si vide
  if (!worldState || !worldState.humans || worldState.humans.length === 0) {
    console.log('🌱 Aucun état trouvé, initialisation du monde...');
    worldState = initState();
  }

  // 3. Appliquer les actions dieu en attente
  const godActions = await sbGet('god_actions?applied=eq.false&select=id,action&order=created_at.asc&limit=20');
  const newEvents = [];
  
  if (godActions.length > 0) {
    console.log(`⚡ ${godActions.length} action(s) divine(s) à appliquer`);
    for (const ga of godActions) {
      applyGodAction(worldState, ga.action, newEvents);
      // Marquer comme appliqué
      await sbPatch(`god_actions?id=eq.${ga.id}`, { applied: true });
    }
  }

  // 4. Faire avancer la simulation
  console.log(`⏩ Exécution de ${TICKS_PER_RUN} ticks...`);
  const notableEvents = [];

  for (let i = 0; i < TICKS_PER_RUN; i++) {
    const beforeTick = newEvents.length;
    tick(worldState, newEvents);
    // Collecter les événements notables de ce tick
    const tickEvents = newEvents.slice(beforeTick).filter(e => e.notable);
    notableEvents.push(...tickEvents);
  }

  console.log(`📊 Après ticks: Pop ${worldState.population}, An ${worldState.year}, Ère ${ERA[worldState.era]}`);
  console.log(`📝 ${newEvents.length} nouveaux événements`);

  // 5. Appeler Gemini si événements notables
  let aiNarrative = null;
  if (notableEvents.length > 0) {
    console.log(`🤖 Appel Gemini pour ${notableEvents.length} événement(s) notable(s)...`);
    aiNarrative = await generateAINarrative(worldState, notableEvents);
    if (aiNarrative) {
      console.log('✨ Chronique IA:', aiNarrative);
      newEvents.push({
        msg: aiNarrative,
        type: 'ai',
        year: worldState.year,
        day: worldState.day,
        ai_generated: true
      });
    }
  }

  // 6. Sauvegarder l'état dans Supabase
  await sbPatch('world_state?id=eq.1', {
    state: worldState,
    tick: currentTick + TICKS_PER_RUN,
    updated_at: new Date().toISOString()
  });
  console.log('💾 État sauvegardé dans Supabase');

  // 7. Insérer les nouveaux événements en chroniques (max 50 par run)
  const eventsToSave = newEvents.slice(-50);
  if (eventsToSave.length > 0) {
    for (const ev of eventsToSave) {
      await sbInsert('chronicles', {
        msg: ev.msg,
        type: ev.type,
        year: ev.year || worldState.year,
        day: ev.day || worldState.day,
        ai_generated: !!ev.ai_generated
      });
    }
    console.log(`📜 ${eventsToSave.length} événements insérés en chroniques`);
  }

  console.log('✅ Run terminé avec succès !');
}

main().catch(err => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});

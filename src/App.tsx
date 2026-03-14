/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { 
  Shield, Heart, Map, Clock, Database, Brain, Sword, 
  BookOpen, ChevronRight, Terminal, Eye, MessageSquare, 
  Send, RotateCcw, Undo, Redo, Save 
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

// --- INITIAL STATE ---
const INITIAL_STATE = {
  pov: "player",
  player: {
    id: "mark_traveler",
    name: "The Traveler",
    health: 100,
    status: "healthy",
    inventory: [
      { id: "silver_stags", name: "Pouch of Silver (50s)", type: "misc", consumable: true },
      { id: "iron_cudgel", name: "Iron Cudgel", type: "weapon", durability: 100 }
    ],
    flags: ["weary", "desperate"]
  },
  world: {
    location: "The Mud-Stained Boar Inn",
    time: "Dusk",
    flags: ["storm_brewing", "guards_absent"]
  },
  npcs: {
    silas: {
      id: "silas_innkeeper",
      name: "Silas",
      health: 50,
      status: "alive",
      latentState: {
        drives: ["protect_his_tavern", "survive_the_winter"],
        fears: ["the_kings_men", "bandits"],
        currentEmotion: "wary",
        withheldIntent: "Knows the bandit camp's location but fears reprisal."
      }
    },
    stranger: {
      id: "stranger",
      name: "Hooded Figure",
      health: 100,
      status: "alive",
      latentState: {
        drives: ["observe", "recruit"],
        fears: ["being_exposed"],
        currentEmotion: "curious",
        withheldIntent: "Is a scout for the bandits, testing the Traveler."
      }
    }
  },
  currentNPC: "silas",
  narrative: {
    sceneText: "The air inside the Boar smells of wet wool and stale ale. The Traveler stands near the hearth, bones aching from the road. Silas, the innkeeper, scrubs a wooden tankard with a dirty rag, his eyes darting toward the door. In the corner, a hooded figure sits motionless, watching. The silence between them is heavier than the iron cudgel at the Traveler's belt.",
    choices: [
      { id: "c1", text: "Ask Silas about the bandits on the road.", type: "dialogue", target: "silas", trigger: "dialogue" },
      { id: "c2", text: "Slide a silver stag across the bar for information.", type: "inventory_use", target: "silas", trigger: "inventory" },
      { id: "c3", text: "Draw the iron cudgel and demand answers.", type: "combat_threat", target: "silas", trigger: "combat" },
      { id: "c4", text: "Approach the hooded figure.", type: "movement", target: "stranger", trigger: "approach" }
    ]
  },
  logs: [
    "The Traveler entered the Mud-Stained Boar, seeking shelter from the rising storm.",
    "Silas the innkeeper watched with wary eyes, scrubbing a tankard.",
    "A hooded figure in the corner remained motionless, a silent observer.",
    "The wind rattled the shutters, a reminder of the dangers on the road."
  ],
  codex: [
    { id: "boar_inn", title: "The Mud-Stained Boar", content: "A decrepit sanctuary for those traveling the Black Road. It is said the stew is better than the beds, though both are likely to turn your stomach." },
    { id: "black_road", title: "The Black Road", content: "The primary trade artery through the southern marshes. Recently plagued by banditry and strange shadows moving in the mist." }
  ]
};

// --- Helper: add unique flags ---
const addFlags = (flagArray: string[], newFlags: string | string[]) => {
  const set = new Set(flagArray);
  (Array.isArray(newFlags) ? newFlags : [newFlags]).forEach(f => set.add(f));
  return Array.from(set);
};

// --- WORLD EVENTS DEFINITION ---
const WORLD_EVENTS = [
  {
    id: 'storm_intensifies',
    name: 'The Storm Breaks',
    description: 'The wind howls with newfound fury, rattling the inn\'s shutters. Rain begins to seep through the thatch.',
    trigger: (state: any) => !state.world.flags.includes('storm_raging'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['storm_raging'] } });
      dispatch({ type: 'ADD_LOG', payload: "The storm has intensified into a gale." });
    }
  },
  {
    id: 'merchant_arrival',
    name: 'A Traveler Arrives',
    description: 'The heavy oak door creaks open, admitting a blast of cold air and a bedraggled merchant clutching a locked chest.',
    trigger: (state: any) => !state.world.flags.includes('merchant_present'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['merchant_present'] } });
      dispatch({ type: 'ADD_LOG', payload: "A weary merchant has entered the inn." });
    }
  },
  {
    id: 'guards_return',
    name: 'Iron Footsteps',
    description: 'The distant clank of armor echoes from the road. The local watch is returning to their posts.',
    trigger: (state: any) => state.world.flags.includes('guards_absent'),
    apply: (dispatch: any) => {
      dispatch({ type: 'REMOVE_FLAGS', payload: { world: ['guards_absent'] } });
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['guards_present'] } });
      dispatch({ type: 'ADD_LOG', payload: "The village guards have returned." });
    }
  },
  {
    id: 'bandit_ambush',
    name: 'Shadows at the Window',
    description: 'A sudden crash comes from the back of the inn. Dark figures are scrambling through the windows—bandits!',
    trigger: (state: any) => state.world.flags.includes('guards_absent') && !state.world.flags.includes('under_attack'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['under_attack', 'bandits_present'] } });
      dispatch({ type: 'SET_NPC_EMOTION', payload: { npc: 'silas', emotion: 'terrified' } });
      dispatch({ type: 'ADD_LOG', payload: "Bandits have breached the inn!" });
    }
  },
  {
    id: 'mysterious_whisper',
    name: 'Voices in the Dark',
    description: 'You hear a faint, rasping whisper right behind your ear, but when you turn, there is only the flickering shadow of the hearth.',
    trigger: (state: any) => true,
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { player: ['unnerved', 'hearing_voices'] } });
      dispatch({ type: 'ADD_LOG', payload: "A ghostly whisper chills your blood." });
    }
  },
  {
    id: 'torch_flicker',
    name: 'The Light Fades',
    description: 'The torches sputter and dim as a draft sweeps through the room. The shadows grow long and hungry.',
    trigger: (state: any) => !state.world.flags.includes('pitch_black'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['dim_light'] } });
      dispatch({ type: 'ADD_LOG', payload: "The light in the room begins to fail." });
    }
  },
  {
    id: 'distant_scream',
    name: 'A Cry in the Night',
    description: 'A blood-curdling scream echoes from somewhere deep in the woods, cut short by a wet, tearing sound.',
    trigger: (state: any) => true,
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_LOG', payload: "A scream echoed from the darkness outside." });
    }
  },
  {
    id: 'rat_infestation',
    name: 'Scurrying Feet',
    description: 'A swarm of large, grey rats surges from the shadows, their eyes glinting like red beads as they disappear into the floorboards.',
    trigger: (state: any) => !state.world.flags.includes('rats_seen'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['rats_seen'] } });
      dispatch({ type: 'ADD_LOG', payload: "Rats are scurrying in the shadows." });
    }
  },
  {
    id: 'strange_glow',
    name: 'The Balefire',
    description: 'A sickly green glow begins to emanate from the cracks in the stone hearth, casting long, distorted shadows.',
    trigger: (state: any) => !state.world.flags.includes('strange_glow'),
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { world: ['strange_glow'] } });
      dispatch({ type: 'ADD_LOG', payload: "A mysterious green glow fills the room." });
    }
  },
  {
    id: 'floorboard_creak',
    name: 'The House Breathes',
    description: 'A floorboard creaks loudly upstairs, followed by the slow, deliberate sound of something heavy being dragged.',
    trigger: (state: any) => true,
    apply: (dispatch: any) => {
      dispatch({ type: 'ADD_FLAGS', payload: { player: ['paranoid'] } });
      dispatch({ type: 'ADD_LOG', payload: "You heard something moving upstairs." });
    }
  },
  {
    id: 'ancient_whispers',
    name: 'Ancient Whispers',
    description: 'For a brief moment, the shadows in the corner seem to form a pattern, a forgotten sigil of the Old Kingdom.',
    trigger: (state: any) => !state.codex.some((e: any) => e.id === 'old_kingdom_sigil'),
    apply: (dispatch: any) => {
      dispatch({ 
        type: 'ADD_CODEX_ENTRY', 
        payload: { 
          id: 'old_kingdom_sigil', 
          title: 'The Sigil of Oros', 
          content: 'An ancient mark of the Orosian dynasty. Its presence here suggests the inn was built upon much older, perhaps sacred, foundations.' 
        } 
      });
      dispatch({ type: 'ADD_LOG', payload: "You discovered a hidden sigil in the shadows." });
    }
  }
];

// --- Reducer ---
function gameReducer(state: any, action: any) {
  switch (action.type) {
    case 'SET_STATE':
      return action.payload;
    case 'SET_POV':
      return { ...state, pov: action.payload };
    case 'SET_CURRENT_NPC':
      return { ...state, currentNPC: action.payload };
    case 'ADD_FLAGS':
      return {
        ...state,
        world: {
          ...state.world,
          flags: addFlags(state.world.flags, action.payload.world || [])
        },
        player: {
          ...state.player,
          flags: addFlags(state.player.flags, action.payload.player || [])
        }
      };
    case 'REMOVE_FLAGS':
      return {
        ...state,
        world: {
          ...state.world,
          flags: state.world.flags.filter((f: string) => !(action.payload.world || []).includes(f))
        },
        player: {
          ...state.player,
          flags: state.player.flags.filter((f: string) => !(action.payload.player || []).includes(f))
        }
      };
    case 'REMOVE_INVENTORY_ITEM':
      return {
        ...state,
        player: {
          ...state.player,
          inventory: state.player.inventory.filter((i: any) => i.id !== action.payload)
        }
      };
    case 'ADD_INVENTORY_ITEM':
      return {
        ...state,
        player: {
          ...state.player,
          inventory: [...state.player.inventory, action.payload]
        }
      };
    case 'UPDATE_WORLD':
      return {
        ...state,
        world: {
          ...state.world,
          ...action.payload
        }
      };
    case 'ADD_CODEX_ENTRY':
      return {
        ...state,
        codex: [...state.codex, action.payload]
      };
    case 'SET_NPC_EMOTION':
      return {
        ...state,
        npcs: {
          ...state.npcs,
          [action.payload.npc]: {
            ...state.npcs[action.payload.npc],
            latentState: {
              ...state.npcs[action.payload.npc].latentState,
              currentEmotion: action.payload.emotion
            }
          }
        }
      };
    case 'ADD_LOG':
      return {
        ...state,
        logs: [...state.logs, action.payload]
      };
    case 'TICK':
      const times = ["Midnight", "Late Night", "Pre-Dawn", "Dawn", "Early Morning"];
      const currentIndex = times.indexOf(state.world.time);
      const nextTime = times[(currentIndex + 1) % times.length];
      return {
        ...state,
        world: {
          ...state.world,
          time: nextTime
        }
      };
    case 'SET_NARRATIVE':
      return {
        ...state,
        narrative: {
          ...state.narrative,
          sceneText: action.payload.sceneText,
          choices: action.payload.choices || state.narrative.choices
        }
      };
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

// --- Load from localStorage ---
const loadInitialState = () => {
  try {
    const saved = localStorage.getItem('gameState');
    if (!saved) return INITIAL_STATE;
    const parsed = JSON.parse(saved);
    // Migration: ensure new properties like 'codex' exist
    return {
      ...INITIAL_STATE,
      ...parsed,
      player: { ...INITIAL_STATE.player, ...parsed.player },
      world: { ...INITIAL_STATE.world, ...parsed.world },
      codex: parsed.codex || INITIAL_STATE.codex
    };
  } catch {
    return INITIAL_STATE;
  }
};

// --- GEMINI LLM CALL ---
const callLLM = async (prompt: string, systemInstruction: string) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("Gemini API key missing");
    return null;
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            councilReports: {
              type: Type.OBJECT,
              properties: {
                narrator: { type: Type.STRING, description: "Prose and tone analysis." },
                mechanist: { type: Type.STRING, description: "Mechanical impact and state consistency check." },
                psychologist: { type: Type.STRING, description: "NPC emotional and motivational shift analysis." },
                archivist: { type: Type.STRING, description: "Historical continuity and log summary." }
              },
              required: ["narrator", "mechanist", "psychologist", "archivist"]
            },
            sceneText: { type: Type.STRING, description: "The narrative text for the scene (3-5 sentences)." },
            logMessage: { type: Type.STRING, description: "A short, objective summary of the action's outcome for the archivist logs." },
            choices: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING, description: "The text displayed to the player for this choice." },
                  type: { type: Type.STRING, description: "The category of the action." },
                  target: { type: Type.STRING, description: "The ID of the NPC or object targeted." }
                },
                required: ["id", "text", "type"]
              }
            },
            stateUpdates: {
              type: Type.OBJECT,
              properties: {
                npcEmotion: { type: Type.STRING },
                newFlags: {
                  type: Type.OBJECT,
                  properties: {
                    world: { type: Type.ARRAY, items: { type: Type.STRING } },
                    player: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                },
                inventoryChanges: {
                  type: Type.OBJECT,
                  properties: {
                    add: { type: Type.ARRAY, items: { 
                      type: Type.OBJECT, 
                      properties: { 
                        id: { type: Type.STRING }, 
                        name: { type: Type.STRING }, 
                        description: { type: Type.STRING } 
                      } 
                    } },
                    remove: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                },
                worldChanges: {
                  type: Type.OBJECT,
                  properties: {
                    location: { type: Type.STRING },
                    time: { type: Type.STRING }
                  }
                },
                codexUpdates: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      content: { type: Type.STRING }
                    },
                    required: ["id", "title", "content"]
                  }
                }
              }
            }
          },
          required: ["sceneText", "choices", "logMessage", "councilReports"]
        }
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error('LLM call failed:', error);
    return null;
  }
};

// --- Generate scene using the enhanced prompt ---
const generateLLMScene = async (state: any, actionDescription: string, customSpeech = "") => {
  const { pov, currentNPC, npcs, world, player, logs } = state;
  const npc = npcs[currentNPC];
  
  const povCharacter = pov === "player" ? "the traveler" : (npcs[pov]?.name || pov);
  const recentHistory = logs.slice(-5).join('\n');

  const systemInstruction = `You are the Council of Gamemasters overseeing a dark medieval fantasy world.
  Your task is to process the player's action through four specialized agentic filters:

  1. THE NARRATOR: Focuses on gritty, grounded, sensory prose (3-5 sentences).
  2. THE MECHANIST: Ensures state consistency (flags, inventory, health) and determines success/failure.
  3. THE PSYCHOLOGIST: Tracks NPC emotions, drives, and withheld intents.
  4. THE ARCHIVIST: Maintains historical continuity, summarizes events for the log, and updates the World Codex with new lore or discoveries.

  Tone: Grim, atmospheric, tense.
  Perspective: Third person limited following ${povCharacter}.

  Rules:
  - Provide a 'councilReport' from each agent explaining their reasoning.
  - Describe only what could realistically happen next.
  - Suggest state updates only if strictly warranted.
  - Provide 3-4 meaningful choices.
  - Use 'codexUpdates' to add new lore entries if the player discovers something significant about the world, history, or characters. This is especially relevant when the player uses the 'investigate' action to explore their surroundings.`;

  const prompt = `
  Recent events (Archivist):
  ${recentHistory}

  Current Context:
  - Location: ${world.location}
  - Time: ${world.time}
  - World Flags: ${world.flags.join(', ')}
  - Player Flags: ${player.flags.join(', ')}
  - NPC (${npc.name}) Emotion: ${npc.latentState.currentEmotion}
  - NPC Drives: ${npc.latentState.drives.join(', ')}
  - NPC Withheld Intent: ${npc.latentState.withheldIntent}
  - Player Inventory: ${player.inventory.map((i: any) => i.name).join(', ')}

  The player performs the following action: "${actionDescription}". 
  ${customSpeech ? `The player specifically said: "${customSpeech}".` : ""}

  Gamemaster Council, deliberate and provide the next scene.`;

  return await callLLM(prompt, systemInstruction);
};

// --- Intent parser ---
const parseIntent = (text: string) => {
  const lower = text.toLowerCase();
  let intent = 'dialogue';
  let confidence = 0;
  const threats = ['kill', 'die', 'smash', 'blood', 'hurt', 'weapon', 'cudgel', 'threat', 'demand', 'answer me'];
  const bribes = ['silver', 'coin', 'money', 'pay', 'bribe', 'buy', 'stag', 'gold', 'payment'];

  threats.forEach(word => {
    if (lower.includes(word)) {
      confidence += 1;
      intent = 'combat_threat';
    }
  });
  bribes.forEach(word => {
    if (lower.includes(word)) {
      confidence += 1;
      if (intent !== 'combat_threat') intent = 'bribe';
    }
  });
  return { intent, confidence };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, null, loadInitialState);
  const [history, setHistory] = useState({ past: [] as any[], future: [] as any[] });
  const [processingState, setProcessingState] = useState<string | null>(null);
  const [agentLogs, setAgentLogs] = useState<any[]>([]);
  const [customInput, setCustomInput] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-save to localStorage
  useEffect(() => {
    if (!state) return;
    const timeout = setTimeout(() => {
      localStorage.setItem('gameState', JSON.stringify(state));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [state]);

  // Scroll to bottom on new logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs]);

  // Wrapped dispatch to record history
  const wrappedDispatch = (action: any) => {
    setHistory(prev => ({
      past: [...prev.past, state],
      future: []
    }));
    dispatch(action);
  };

  const addAgentLog = useCallback((agent: string, msg: string, color: string) => {
    setAgentLogs(prev => [...prev, { agent, msg, color }]);
  }, []);

  // Undo/Redo functions
  const undo = () => {
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    const newPast = history.past.slice(0, -1);
    setHistory({
      past: newPast,
      future: [state, ...history.future]
    });
    dispatch({ type: 'SET_STATE', payload: previous });
  };

  const redo = () => {
    if (history.future.length === 0) return;
    const next = history.future[0];
    const newFuture = history.future.slice(1);
    setHistory({
      past: [...history.past, state],
      future: newFuture
    });
    dispatch({ type: 'SET_STATE', payload: next });
  };

  const handleReset = () => {
    wrappedDispatch({ type: 'RESET' });
    setAgentLogs([]);
    setProcessingState(null);
    setCustomInput('');
  };

  const processAction = async (choice: any) => {
    setAgentLogs([]);
    const actionText = choice.text;
    const customText = choice.customText || "";
    const targetNPC = choice.target || state.currentNPC;
    let eventSummary = `Traveler performed action: ${actionText}`;
    let npcEmotion = state.npcs[targetNPC].latentState.currentEmotion;
    let newFlags = { world: [] as string[], player: [] as string[] };
    let removeItem = null;
    let sceneText = "";
    let newChoices = null;

    addAgentLog("Input", `Action: ${actionText}`, "text-blue-400");
    await sleep(400);

    // Step 1: Logic / Intent (Optional: could be handled by LLM entirely, but keeping some deterministic logic)
    if (choice.type === "inventory_use") {
      removeItem = choice.itemId;
      addAgentLog("InventoryAI", `Using item: ${choice.itemId}`, "text-yellow-400");
    }

    // Increment World Clock every 3 actions
    if (state.logs.length % 3 === 0) {
      wrappedDispatch({ type: 'TICK' });
      addAgentLog("WorldEngine", "Time flows forward...", "text-amber-400");
    }

    // Dynamic World Event Check (25% chance)
    let worldEventText = "";
    if (Math.random() < 0.25) {
      const possibleEvents = WORLD_EVENTS.filter(e => e.trigger(state));
      if (possibleEvents.length > 0) {
        const event = possibleEvents[Math.floor(Math.random() * possibleEvents.length)];
        setProcessingState("WorldEngine");
        addAgentLog("WorldEngine", `Triggering Event: ${event.name}`, "text-amber-500");
        event.apply(wrappedDispatch);
        worldEventText = event.description;
        await sleep(600);
      }
    }

    // Step 4: Narrator LLM
    setProcessingState("NarratorLLM");
    addAgentLog("NarratorLLM", `Synthesizing scene via LLM...`, "text-indigo-400");
    await sleep(800);

    // Build temporary state for scene generation
    const tempState = {
      ...state,
      world: {
        ...state.world,
        flags: addFlags(state.world.flags, newFlags.world)
      },
      player: {
        ...state.player,
        flags: addFlags(state.player.flags, newFlags.player)
      },
      npcs: {
        ...state.npcs,
        [targetNPC]: {
          ...state.npcs[targetNPC],
          latentState: {
            ...state.npcs[targetNPC].latentState,
            currentEmotion: npcEmotion
          }
        }
      }
    };
    
    const narrativeContext = worldEventText 
      ? `${eventSummary}. Suddenly, ${worldEventText}`
      : eventSummary;

    const llmResult = await generateLLMScene(tempState, narrativeContext, customText);

    if (llmResult) {
      sceneText = llmResult.sceneText;
      newChoices = llmResult.choices;
      eventSummary = llmResult.logMessage || eventSummary;
      
      // Display Council Reports
      if (llmResult.councilReports) {
        const cr = llmResult.councilReports;
        addAgentLog("Mechanist", cr.mechanist, "text-blue-300");
        await sleep(300);
        addAgentLog("Psychologist", cr.psychologist, "text-purple-300");
        await sleep(300);
        addAgentLog("Archivist", cr.archivist, "text-emerald-300");
        await sleep(300);
        addAgentLog("Narrator", cr.narrator, "text-indigo-300");
        await sleep(300);
      }

      // Incorporate LLM suggested state updates
      if (llmResult.stateUpdates) {
        const su = llmResult.stateUpdates;
        if (su.npcEmotion) {
          npcEmotion = su.npcEmotion;
        }
        if (su.newFlags) {
          newFlags.world = addFlags(newFlags.world, su.newFlags.world || []);
          newFlags.player = addFlags(newFlags.player, su.newFlags.player || []);
        }
        if (su.inventoryChanges) {
          if (su.inventoryChanges.add) {
            su.inventoryChanges.add.forEach((item: any) => {
              wrappedDispatch({ type: 'ADD_INVENTORY_ITEM', payload: item });
              addAgentLog("InventoryAI", `Acquired: ${item.name}`, "text-yellow-400");
            });
          }
          if (su.inventoryChanges.remove) {
            su.inventoryChanges.remove.forEach((itemId: string) => {
              wrappedDispatch({ type: 'REMOVE_INVENTORY_ITEM', payload: itemId });
              addAgentLog("InventoryAI", `Lost: ${itemId}`, "text-yellow-600");
            });
          }
        }
        if (su.worldChanges) {
          wrappedDispatch({ type: 'UPDATE_WORLD', payload: su.worldChanges });
          if (su.worldChanges.location) addAgentLog("WorldEngine", `Location shift: ${su.worldChanges.location}`, "text-amber-400");
        }
        if (su.codexUpdates) {
          su.codexUpdates.forEach((entry: any) => {
            // Check if entry already exists to avoid duplicates
            if (!state.codex.some((e: any) => e.id === entry.id)) {
              wrappedDispatch({ type: 'ADD_CODEX_ENTRY', payload: entry });
              addAgentLog("Archivist", `New Codex Entry: ${entry.title}`, "text-emerald-400");
            }
          });
        }
      }
    } else {
      sceneText = "The vision grows hazy... (LLM failed)";
      newChoices = state.narrative.choices;
    }

    // Apply state changes
    if (newFlags.world.length || newFlags.player.length) {
      wrappedDispatch({ type: 'ADD_FLAGS', payload: newFlags });
    }
    if (removeItem) {
      wrappedDispatch({ type: 'REMOVE_INVENTORY_ITEM', payload: removeItem });
    }
    wrappedDispatch({
      type: 'SET_NPC_EMOTION',
      payload: { npc: targetNPC, emotion: npcEmotion }
    });
    wrappedDispatch({ type: 'ADD_LOG', payload: eventSummary });

    wrappedDispatch({
      type: 'SET_NARRATIVE',
      payload: { sceneText, choices: newChoices }
    });

    addAgentLog("NarratorLLM", "Generated Scene successfully.", "text-green-400");
    setProcessingState(null);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim() || processingState) return;
    const choice = {
      id: "custom_" + Date.now(),
      text: customInput,
      type: "free_text",
      customText: customInput.trim(),
      target: state.currentNPC,
      trigger: "dialogue"
    };
    setCustomInput("");
    processAction(choice);
  };

  const togglePOV = async () => {
    const nextPOV = state.pov === "player" ? state.currentNPC : "player";
    wrappedDispatch({ type: 'SET_POV', payload: nextPOV });
    
    // Trigger re-narration for the new POV
    setProcessingState("NarratorLLM");
    addAgentLog("NarratorLLM", `Shifting perspective to ${nextPOV === 'player' ? 'The Traveler' : state.npcs[nextPOV].name}...`, "text-indigo-400");
    
    const tempState = { ...state, pov: nextPOV };
    const llmResult = await generateLLMScene(tempState, "Perspective shift / Observation");
    
    if (llmResult) {
      wrappedDispatch({
        type: 'SET_NARRATIVE',
        payload: { sceneText: llmResult.sceneText, choices: llmResult.choices }
      });
    }
    setProcessingState(null);
  };

  const getAvailableInteractions = () => {
    const npc = state.npcs[state.currentNPC];
    const interactions = [];

    // Talk
    interactions.push({
      id: `talk_${npc.id}`,
      text: `Speak with ${npc.name}`,
      type: 'dialogue',
      target: state.currentNPC,
      trigger: 'dialogue'
    });

    // Barter
    const hasSilver = state.player.inventory.some((i: any) => i.id === 'silver_stags');
    if (hasSilver && npc.latentState.currentEmotion !== 'terrified') {
      interactions.push({
        id: `barter_${npc.id}`,
        text: `Offer silver to ${npc.name}`,
        type: 'inventory_use',
        itemId: 'silver_stags',
        target: state.currentNPC,
        trigger: 'inventory'
      });
    }

    // Intimidate
    const hasWeapon = state.player.inventory.some((i: any) => i.id === 'iron_cudgel');
    if (hasWeapon) {
      interactions.push({
        id: `intimidate_${npc.id}`,
        text: `Threaten ${npc.name} with your cudgel`,
        type: 'combat_threat',
        target: state.currentNPC,
        trigger: 'combat'
      });
    }

    // Observe
    interactions.push({
      id: `observe_${npc.id}`,
      text: `Study ${npc.name}'s mannerisms`,
      type: 'observe',
      target: state.currentNPC,
      trigger: 'observation'
    });

    // Movement (switch NPC)
    Object.keys(state.npcs).forEach(npcId => {
      if (npcId !== state.currentNPC) {
        interactions.push({
          id: `approach_${npcId}`,
          text: `Approach the ${state.npcs[npcId].name}`,
          type: 'movement',
          target: npcId,
          trigger: 'approach'
        });
      }
    });

    // Investigate Environment
    interactions.push({
      id: `investigate_${state.world.location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      text: `Investigate the surroundings`,
      type: 'investigate',
      target: 'environment',
      trigger: 'investigation'
    });

    // Special Narrative Choices (e.g. Travel, Quest actions)
    const specialChoices = state.narrative.choices.filter((c: any) => 
      !['dialogue', 'inventory_use', 'combat_threat', 'movement'].includes(c.type)
    );
    interactions.push(...specialChoices);

    return interactions;
  };

  if (!state) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500">Loading the Chronicler's Loom...</div>;

  const interactions = getAvailableInteractions();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-300 font-serif sm:p-4 md:p-8 flex flex-col md:flex-row gap-4 selection:bg-amber-900 selection:text-amber-100">
      
      {/* LEFT COLUMN: Main Game UI */}
      <div className="w-full md:w-2/3 flex flex-col gap-4">
        
        <header className="bg-neutral-900 border border-neutral-800 rounded-sm p-4 flex flex-wrap justify-between items-center shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs text-neutral-500 uppercase tracking-widest font-sans font-bold">Subject</span>
              <span className="text-lg font-bold text-neutral-100">{state.player.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 mt-2 sm:mt-0 font-sans">
            <button 
              onClick={togglePOV}
              className="flex items-center gap-2 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-amber-500 text-sm transition-colors"
              aria-label="Toggle point of view"
            >
              <Eye size={16} /> POV: {state.pov.toUpperCase()}
            </button>
            <button
              onClick={undo}
              disabled={history.past.length === 0}
              className="flex items-center gap-2 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-amber-500 text-sm transition-colors disabled:opacity-30"
              aria-label="Undo"
            >
              <Undo size={16} /> Undo
            </button>
            <button
              onClick={redo}
              disabled={history.future.length === 0}
              className="flex items-center gap-2 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-amber-500 text-sm transition-colors disabled:opacity-30"
              aria-label="Redo"
            >
              <Redo size={16} /> Redo
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-amber-500 text-sm transition-colors"
              aria-label="Restart game"
            >
              <RotateCcw size={16} /> Restart
            </button>
            <div className="flex items-center gap-2 text-rose-800">
              <Heart size={18} />
              <span className="font-mono">{state.player.health}</span>
            </div>
          </div>
        </header>

        <main className="bg-[#0f0f0f] border border-neutral-800 rounded-sm p-4 sm:p-6 shadow-2xl flex-grow flex flex-col relative">
          
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-neutral-800 font-sans">
            <BookOpen size={20} className="text-amber-700" />
            <h2 className="text-sm uppercase tracking-widest font-bold text-amber-700">The Chronicler's Loom</h2>
          </div>
          
          <div className="flex-grow">
            {processingState === "NarratorLLM" ? (
              <div className="flex items-center gap-3 text-neutral-500 animate-pulse mt-4">
                <Brain size={20} className="animate-spin" />
                <span>LLM is synthesizing reality...</span>
              </div>
            ) : (
              <p className="text-lg sm:text-xl leading-relaxed text-neutral-200 mb-8 whitespace-pre-wrap">
                {state.narrative.sceneText}
              </p>
            )}
          </div>

          {/* Actions & Free Dialogue Input */}
          <div className="flex flex-col gap-2 mt-auto font-sans">
            <div className="text-[10px] text-neutral-600 uppercase tracking-widest font-bold mb-1 flex items-center gap-2">
              <ChevronRight size={12}/> Interaction Menu: {state.npcs[state.currentNPC].name.toUpperCase()}
            </div>
            
            {/* Dynamic Interaction Choices */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {interactions.map((choice: any) => (
                <button
                  key={choice.id}
                  onClick={() => processAction(choice)}
                  disabled={processingState !== null}
                  className={`text-left p-3 rounded-sm border transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-amber-700
                    ${processingState 
                      ? 'border-neutral-900 bg-neutral-950 text-neutral-700 cursor-not-allowed' 
                      : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-amber-900/50 text-neutral-300 shadow-md'
                    }`}
                  aria-label={choice.text}
                >
                  <div className="flex items-center gap-3">
                    {choice.type === 'combat_threat' ? <Sword size={16} className="text-rose-800"/> : 
                     choice.type === 'inventory_use' ? <Database size={16} className="text-amber-600"/> :
                     choice.type === 'movement' ? <Map size={16} className="text-green-600"/> :
                     choice.type === 'observe' ? <Eye size={16} className="text-cyan-600"/> :
                     <MessageSquare size={16} className="text-neutral-500"/>}
                    <span className="text-xs sm:text-sm">{choice.text}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Free Text Input Form */}
            {interactions.length > 0 && (
              <form onSubmit={handleCustomSubmit} className="mt-2 flex gap-2 w-full">
                <div className="relative flex-grow">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MessageSquare size={16} className="text-neutral-500" />
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    disabled={processingState !== null}
                    placeholder={`Speak to ${state.npcs[state.currentNPC].name}...`}
                    className="w-full pl-10 pr-4 py-3 sm:py-4 bg-neutral-900 border border-neutral-800 rounded-sm text-neutral-200 text-sm sm:text-md focus:outline-none focus:border-amber-700 focus:ring-1 focus:ring-amber-700 transition-colors disabled:opacity-50"
                    aria-label="Free text input"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={!customInput.trim() || processingState !== null}
                  className="bg-amber-900 hover:bg-amber-800 disabled:bg-neutral-800 disabled:text-neutral-600 text-amber-100 px-4 sm:px-6 py-3 sm:py-4 rounded-sm font-bold transition-colors flex items-center justify-center active:scale-[0.95] focus:outline-none focus:ring-2 focus:ring-amber-700"
                  aria-label="Send"
                >
                  <Send size={18} />
                </button>
              </form>
            )}
          </div>
        </main>
      </div>

      {/* RIGHT COLUMN: Engine Diagnostics */}
      <div className="w-full md:w-1/3 flex flex-col gap-4 font-sans">
        
        <div className="bg-black border border-neutral-800 rounded-sm flex flex-col shadow-2xl overflow-hidden h-64 md:h-auto md:flex-grow">
          <div className="bg-neutral-900 p-3 border-b border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-amber-600" />
              <span className="text-xs uppercase tracking-widest font-bold text-neutral-400">System Logs</span>
            </div>
            {processingState && (
              <span className="text-[10px] uppercase font-mono animate-pulse text-amber-500">
                [{processingState}]
              </span>
            )}
          </div>
          <div className="p-4 flex-grow overflow-y-auto font-mono text-[11px] sm:text-xs space-y-3 relative">
            {agentLogs.length === 0 && !processingState && (
              <div className="text-neutral-700 italic">Awaiting discrete choice or free text injection...</div>
            )}
            {agentLogs.map((log, index) => (
              <div key={index} className="flex flex-col border-l border-neutral-800 pl-2">
                <span className={`${log.color}`}>
                  <span className="font-bold opacity-75 block text-[9px] mb-1">[{log.agent}]</span> 
                  {log.msg}
                </span>
              </div>
            ))}
            {processingState === "NarratorLLM" && (
              <div className="flex justify-center py-2">
                <button 
                  className="text-[10px] px-3 py-1 bg-blue-900/30 border border-blue-800 text-blue-400 rounded-sm hover:bg-blue-900/50 transition-colors animate-pulse"
                  onClick={() => setProcessingState(null)}
                >
                  Generate in background
                </button>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-sm p-4 shadow-2xl">
          <h3 className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
            <Shield size={14}/> Canonical State
          </h3>
          
          <div className="mb-4 space-y-4">
            <div className="text-[10px] uppercase text-neutral-600 mb-2 border-b border-neutral-800 pb-1">NPC Manifest:</div>
            {Object.entries(state.npcs).map(([id, npc]: [string, any]) => (
              <div key={id} className={`p-2 rounded-sm border ${state.currentNPC === id ? 'border-amber-900/50 bg-neutral-950' : 'border-neutral-800 bg-neutral-900/50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className={`text-sm font-bold ${state.currentNPC === id ? 'text-amber-400' : 'text-neutral-400'}`}>
                    {npc.name} {state.currentNPC === id && <span className="text-[8px] ml-1 opacity-50">(CURRENT)</span>}
                  </span>
                  <span className="text-[10px] text-neutral-500 italic">{npc.latentState.currentEmotion}</span>
                </div>
                
                <details className="group">
                  <summary className="text-[9px] uppercase tracking-tighter text-neutral-600 cursor-pointer hover:text-neutral-400 transition-colors list-none flex items-center gap-1">
                    <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                    Latent State
                  </summary>
                  <div className="mt-2 space-y-2 pl-2 border-l border-neutral-800 py-1">
                    <div>
                      <div className="text-[8px] uppercase text-neutral-700 font-bold">Drives</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {npc.latentState.drives.map((drive: string) => (
                          <span key={drive} className="text-[9px] bg-neutral-950 px-1 border border-neutral-800 text-neutral-500">{drive.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase text-neutral-700 font-bold">Fears</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {npc.latentState.fears.map((fear: string) => (
                          <span key={fear} className="text-[9px] bg-neutral-950 px-1 border border-neutral-800 text-rose-900/70">{fear.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase text-neutral-700 font-bold">Withheld Intent</div>
                      <div className="text-[10px] text-neutral-400 italic mt-0.5 leading-tight">
                        "{npc.latentState.withheldIntent}"
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <div className="text-[10px] uppercase text-neutral-600 mb-1">Inventory:</div>
            <ul className="space-y-1">
              {state.player.inventory.map((item: any) => (
                <li key={item.id} className="text-xs text-neutral-400 flex justify-between bg-neutral-950 px-2 py-1 border border-neutral-800">
                  <span>{item.name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase text-neutral-600 mb-1">Active Flags:</div>
            <div className="flex flex-wrap gap-2">
              {state.player.flags.concat(state.world.flags).map((flag: string) => (
                <span key={flag} className="px-1.5 py-0.5 bg-neutral-950 border border-neutral-800 text-[10px] font-mono text-amber-700">
                  {flag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* WORLD CODEX */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-sm p-4 shadow-2xl">
          <h3 className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
            <BookOpen size={14}/> World Codex
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
            {state.codex?.map((entry: any) => (
              <div key={entry.id} className="border-b border-neutral-800 pb-2 last:border-0">
                <div className="text-[11px] font-bold text-amber-600 uppercase mb-1">{entry.title}</div>
                <div className="text-[10px] text-neutral-400 leading-relaxed italic">
                  {entry.content}
                </div>
              </div>
            ))}
            {(!state.codex || state.codex.length === 0) && (
              <div className="text-[10px] text-neutral-600 italic">No lore discovered yet...</div>
            )}
          </div>
          
          <div className="mt-4 pt-3 border-t border-neutral-800 border-dashed">
            <div className="text-[9px] text-neutral-500 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-900 animate-pulse" />
              Go more in depth with a codex
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

const TUNING = {
  // Item effect durations (in frames, ~60fps)
  BOOST_DURATION: 75,
  CITATION_BOOST_DURATION: 24,
  CITATION_BOOST_EVERY: 5,
  CITATION_SPEED_PER_STACK: 0,
  CITATION_SPEED_MAX_STACKS: 20,
  ULTIMATE_COINS_NEEDED: 10,
  ULTIMATE_DURATION_BASE: 180,
  SHIELD_DURATION: 360,
  SHIELD_DURATION_RISSAL: 540,
  HANDLING_DURATION: 360,
  HOTFIX_DURATION: 150,
  FAST_TRACK_DURATION: 180,
  DOUBLE_BLIND_DURATION: 180,
  PLACEBO_SLOW_DURATION: 90,
  ITEM_ROLL_TIME: 45,
  SPINOUT_TIME: 45,
  SPINOUT_TIME_SHORT: 22,

  // Drift mini-turbo charge thresholds
  DRIFT_TIER1: 25,
  DRIFT_TIER2: 60,
  DRIFT_TIER3: 100,

  // Drift mini-turbo boost durations (frames)
  DRIFT_BOOST_T1: 24,
  DRIFT_BOOST_T2: 48,
  DRIFT_BOOST_T3: 72,
  DRIFT_SPEED_RETENTION: 0.986,
  DRIFT_TURN_MULT: 1.65,
  DRIFT_CHARGE_RATE: 1.18,
  DRIFT_SPARK_CHANCE: 0.52,

  // Physics
  BRAKE_FORCE: 0.18,
  FRICTION: 0.020,
  REVERSE_MAX: 2.4,
  GRIP_NORMAL: 0.18,
  GRIP_DRIFT: 0.045,
  GRIP_NORMAL_ANTON: 0.14,
  GRIP_DRIFT_ANTON: 0.035,
  OFF_ROAD_SPEED_MULT: 0.65,

  // Spatial audio
  SPATIAL_RANGE: 1200,
  SPATIAL_PAN_RANGE: 300,

  // Music
  FINAL_LAP_TEMPO_BOOST: 18,

  // Catch-up boost for trailing human karts
  PLAYER_CATCHUP_MAX: 0.12,
  PLAYER_CATCHUP_RANGE: 900,

  // P2P sync
  P2P_MAX_BUFFERED_BYTES: 64 * 1024,
  P2P_PICKUP_FULL_SYNC_INTERVAL_MS: 1200,
  P2P_HOST_SYNC_HZ: 18,
  P2P_GUEST_SYNC_HZ: 20,
  P2P_HAZARD_SYNC_HZ: 6,
  P2P_REMOTE_INTERP: 0.25,
  P2P_REMOTE_SNAP_DIST: 240,
  P2P_REMOTE_VELOCITY_LEAD: 3.0,
};
const QUOTES = {
  anton: {
    boost: [
      "More efficiencyyyy!",
      "one worker one love",
      "Types faster than he spells!",
      "added new bastract with tests",
      "pimp overall",
      "use nice model actually"
    ],
    crash: [
      "btet icon!",
      "pomrpt pimping!",
      "height is broken...",
      "arutr nitpicks!",
      "naalysis is hard",
      "make it work maybe",
      "remove weird chat name thingy"
    ],
    overtake: [
      "nice readme bro",
      "More better versions!",
      "tests actually pass wtf",
      "chunking actually quite nice now",
      "make it actually select docs"
    ],
    collide: [
      "arutr nitpicks!",
      "nice feedback bro",
      "token mat bye",
      "actually instantiate redis",
      "nicer exampels"
    ],
    lap: [
      "tests actually pass wtf!",
      "one worker one love",
      "Better respodner",
      "we actually extracted facts twice",
      "All pytests passed and looks good"
    ]
  },
  artur: {
    boost: [
      "FIYAAA!",
      "prompty GOT HANDS!",
      "damn daisy got hands",
      "holy shit it works",
      "cloud YES",
      "workcraft workers yaaaa"
    ],
    crash: [
      "Damn window heights...",
      "The window height is broken!",
      "Wait, who broke my prompt?",
      "No sound effects on Safari smh",
      "whoopsie",
      "hotfix pdf viewer build stuff"
    ],
    overtake: [
      "Who is this guy? Bye!",
      "damn anton got hands",
      "prompty got hands!",
      "Add retries for everything lol",
      "workraft working babyyy"
    ],
    collide: [
      "No sound on Safari!",
      "Damn window heights...",
      "Who broke my layout?!",
      "actualyl no need for singleton",
      "bypass gcp csrf security thingy"
    ],
    lap: [
      "FIYAAA!",
      "holy shit it works",
      "holy shit the loops work",
      "dear god please work",
      "yes please"
    ]
  },
  rissal: {
    boost: [
      "Hopefully works!",
      "Let's test this change...",
      "I hope this builds...",
      "Works as advertised now",
      "Message format works with images now"
    ],
    crash: [
      "PANIC!",
      "Most dangerous message!",
      "Ahhh! Syntax error!",
      "Merge conflict on master!",
      "Nevermind, did not work, still slow",
      "still slow"
    ],
    overtake: [
      "Hurray!",
      "It actually works!",
      "See ya!",
      "Export feature working",
      "Dots menu works for all chats"
    ],
    collide: [
      "PANIC!",
      "Don't touch my workspace!",
      "Most dangerous message...",
      "bind:value goes both ways",
      "radical changes so that it works"
    ],
    lap: [
      "Hurray!",
      "Hopefully works",
      "It works (most dangerous msg)",
      "Works fine now",
      "Modal is working"
    ]
  },
  pia: {
    boost: [
      "Why did I not think of using grid sooner",
      "Protect our endpoints!",
      "So much layouting!",
      "Add pimp-my-prompt functionality",
      "Use openai/chat endpoint"
    ],
    crash: [
      "small loser thinkpad...",
      "Improve vertical spacing for small loser thinkpads",
      "killed weird svg",
      "Fix weird dotenv private key error",
      "Windows browsers..."
    ],
    overtake: [
      "Thinkpads in shambles!",
      "Default user type is default again",
      "Add breakpoint for windows browsers",
      "Pimp my prompt!"
    ],
    collide: [
      "Protect our endpoints from hacky hackers!",
      "small loser thinkpad!",
      "pias review. killed weird svg",
      "Store worker taskid in user message",
      "Remove playwright workflow"
    ],
    lap: [
      "Why did I not think of using grid sooner smh",
      "Default user type is default again",
      "So much layouting",
      "Add pre-commit and workflow",
      "Add playwright github workflow"
    ]
  },
  florian: {
    boost: [
      "Automating clinical trials!",
      "AI-powered SLR submission!",
      "Regulatory greenlight!",
      "Approved by the board!",
      "Replace print with logger!"
    ],
    crash: [
      "Compliance breach?!",
      "Audit warning letter!",
      "Deficiencies found!",
      "FDA rejection!?"
    ],
    overtake: [
      "Fast-track approval!",
      "Accelerated pathway!",
      "Market exclusivity!",
    ],
    collide: [
      "Executive collision!",
      "Non-disclosure agreement!",
      "Please sign this NDA!"
    ],
    lap: [
      "Perfect QALY profile!",
      "Milestone achieved!",
      "Phase 3 trials complete!",
      "PDF viewer builds!",
      "sentry back in"
    ]
  }
};

export { TUNING, QUOTES };

const TAGS = {
  animal: '🐾 ANIMAL', fire: '🔥 FIRE', water: '💧 WATER', magic: '✨ MAGIC', building: '🏗️ BUILDING',
  vehicle: '🚗 VEHICLE', food: '🍔 FOOD', noise: '📢 NOISE', love: '💘 LOVE', politics: '🏛️ POLITICS',
};

const TYPES = {
  wizard: '🧙', raccoon: '🦝', ghost: '👻', robot: '🤖', grandma: '👵',
  vampire: '🧛', alien: '👽', kid: '🧒', pirate: '🦜',
};

const TRAITS = {
  hat: { e: '🎩', n: 'a top hat' },
  glasses: { e: '👓', n: 'glasses' },
  mustache: { e: '🥸', n: 'a fake mustache' },
  bowtie: { e: '🎀', n: 'a bow tie' },
};

const ATTS = ['Form 7B', 'Form 12-C', 'Proof of Existence', "Mom's Permission Slip"];

const INKS = { pen: '🖊️ pen', crayon: '🖍️ crayon', glitter: '✨ glitter pen' };

const NAMES = ['Gerald', 'Brenda', 'Sir Reginald', 'Doug', 'Mildred', 'Chad', 'Gloria', 'Barnaby', 'Trish',
  'Kevin', 'Dolores', 'Fitzgerald', 'Pam', 'Gus', 'Esmeralda', 'Todd', 'Bertha', 'Rex', 'Linda', 'Moe',
  'Wanda', 'Hank', 'Petunia', 'Clive', 'Agnes', 'Steve'];

// bad = headline when wrongly approved (city disaster)
const PERMITS = [
  ['keep a small dragon in a rented apartment', '🐉', ['animal', 'fire'], "DRAGON IN APT 4B TORCHES BAKERY, ASKS FOR CROISSANT"],
  ['marry a lighthouse', '🗼', ['love', 'water'], 'LIGHTHOUSE WEDDING BLINDS ENTIRE HARBOR, 3 BOATS LOST'],
  ['be exempt from gravity on Tuesdays', '🎈', ['magic'], 'CITIZEN FLOATS AWAY, LAST SEEN WAVING OVER CANADA'],
  ['open a pizzeria inside a volcano', '🌋', ['food', 'fire', 'building'], 'VOLCANO PIZZA ERUPTS. TOPPINGS: LAVA'],
  ['build a moat around my garden', '🏰', ['building', 'water'], 'GARDEN MOAT FLOODS SCHOOL, CROCODILES ENROLLED'],
  ['teach pigeons to deliver the mail', '🐦', ['animal'], 'PIGEON POSTAL SERVICE LOSES ALL MAIL, DEMANDS BREAD'],
  ['drive a hot tub on the highway', '🛁', ['vehicle', 'water'], 'HOT TUB CAUSES 40-CAR PILEUP, DRIVER "VERY RELAXED"'],
  ['host a 3am bagpipe concert', '🎶', ['noise'], 'BAGPIPE CONCERT SHATTERS EVERY WINDOW IN TOWN'],
  ['run for mayor', '🎩', ['politics'], 'NEW MAYOR BANS MONDAYS, ALSO SOCKS'],
  ['turn the town fountain into soup', '🍲', ['food', 'water'], 'FOUNTAIN SOUP ATTRACTS 9,000 SEAGULLS'],
  ['adopt 40 cats', '🐈', ['animal'], '40 CATS SEIZE CONTROL OF CITY HALL'],
  ['install a rocket on my bicycle', '🚀', ['vehicle', 'fire'], 'ROCKET BIKE ENTERS LOW ORBIT, NASA "CONFUSED"'],
  ['summon a small storm for my garden', '⛈️', ['magic', 'water'], '"SMALL" STORM FLATTENS THREE NEIGHBORHOODS'],
  ['build a treehouse taller than the bank', '🌳', ['building'], 'GIANT TREEHOUSE TOPPLES ONTO BANK, SQUIRRELS LOOT VAULT'],
  ['sell glow-in-the-dark sandwiches', '🥪', ['food', 'magic'], 'GLOWING SANDWICH EATERS NOW VISIBLE FROM SPACE'],
  ['ride a horse into the library', '🐴', ['animal', 'vehicle'], 'HORSE EATS ENTIRE POETRY SECTION'],
  ['yodel professionally downtown', '🗣️', ['noise'], 'NON-STOP YODELING CAUSES MINOR AVALANCHE'],
  ['rename Tuesday to "Greg-day"', '📅', ['politics'], 'CALENDAR CHAOS: NOBODY KNOWS WHAT DAY IT IS'],
  ['fill my basement with jelly', '🟣', ['food', 'building'], 'JELLY BREACH: GRAPE TSUNAMI HITS MAIN STREET'],
  ["set off fireworks at my cat's birthday", '🎆', ['fire', 'noise'], "CAT'S BIRTHDAY FIREWORKS IGNITE TOWN HALL"],
  ['keep a pet shark in the bathtub', '🦈', ['animal', 'water'], 'BATHTUB SHARK ESCAPES INTO SEWERS, NOW HUGE'],
  ['open a haunted car wash', '🚿', ['vehicle', 'magic', 'water'], 'HAUNTED CAR WASH POSSESSES 12 MINIVANS'],
  ['challenge the mayor to a duel at noon', '🤺', ['politics', 'noise'], 'NOON DUEL ENDS IN TIE, BOTH NOW MAYOR'],
  ['build a roller coaster through my house', '🎢', ['building', 'vehicle'], 'HOME ROLLER COASTER DERAILS INTO NEIGHBOR\'S POOL'],
  ['marry my own reflection', '🪞', ['love', 'magic'], 'MIRROR WEDDING CREATES EVIL TWIN, TWIN DEMANDS HALF'],
  ['open a speed-dating night for ghosts', '💘', ['love', 'noise'], 'GHOST SPEED-DATING HAUNTS CITY FOR A WEEK'],
  ['start a goat taxi service', '🐐', ['animal', 'vehicle'], 'GOAT TAXIS EAT 30 PARKED CARS'],
  ['cook a 500-pound meatball', '🍝', ['food', 'fire'], 'GIANT MEATBALL ROLLS DOWNHILL, FLATTENS POST OFFICE'],
  ['declare my backyard an independent country', '🏳️', ['politics', 'building'], 'BACKYARD NATION DECLARES WAR ON THE MINISTRY'],
  ['propose to the moon', '🌙', ['love', 'magic'], 'MOON SAYS YES, TIDES GO HAYWIRE'],
  ['play the tuba on a submarine', '🎺', ['noise', 'water', 'vehicle'], 'TUBA SUBMARINE ANGERS EVERY WHALE IN THE OCEAN'],
  ['breed fire-breathing chickens', '🐔', ['animal', 'fire', 'food'], 'FIRE CHICKENS ROAST THEMSELVES, AND THE FARM'],
].map(([text, emoji, tags, bad]) => ({ text, emoji, tags, bad }));

const QUOTES = {
  any: [
    "It's for a school project.", 'My lawyer said this was totally fine.', "I've been waiting in line since 1987.",
    "Please, it's my birthday.", 'I brought you a cookie 🍪 (I ate it).', "Don't tell my mom.",
    'I am 100% a regular human citizen.', 'The last clerk said yes. He was a horse.', "I'll name my firstborn after you!",
    "It's not weird if you don't think about it.", 'My horoscope said today was the day.', 'What could POSSIBLY go wrong?',
    'I filled this out with my feet. Be impressed.', 'This is my 47th application. Third time lucky!', "I know a guy who knows a guy.",
    'Is this the line for nachos?', 'My cat signed it. She has excellent handwriting.', "I promise it's mostly safe.",
    "It's a family tradition. Starting today.", 'I would like to speak to the stamp.', 'Approve it or I sing. Loudly.',
    'Trust me, I watched a video about it.', "I've already started. Sorry.", 'Yes, the smell is part of it.',
  ],
  crying: ['*sobbing* I just want this ONE thing!', "*sniff* Nobody understands me…", "*ugly crying* It's been a really long week!"],
  angry: ['I DEMAND TO SEE YOUR MANAGER!', 'THIS IS AN OUTRAGE! Also, hello.', "I'M NOT ANGRY, THIS IS JUST MY VOICE!"],
  calm: ['*sips tea calmly*', 'No rush. Except hurry.', "I've meditated about this permit."],
};

module.exports = { TAGS, TYPES, TRAITS, ATTS, INKS, NAMES, PERMITS, QUOTES };

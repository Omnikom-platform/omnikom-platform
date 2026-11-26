// VTV's (Valley To Valley Realty, Francine Masudi) advisor pack, hand-converted (the head's ruling 2, 2026-11-26) from her own facts
// (clients/vtv/facts.md, clients/vtv/profile.md) and the text of her live site as captured read-only on 2026-10-22
// (E:/Francine & Eli/site-checks/valleytovalleyrealty.com/snapshots/2026-10-22; extract: docs/advisor/r3/vtv/extract-site-text.mjs).
// Rules kept here: a MISSING fact is never guessed (its intent answers "unknown" and offers the form); no price, fee, commission or home-value number
// (no price rows, so the validator refuses any $); no review text (question 10); no marketing numbers ("$25M+", "Top 1.5%": not facts); no "over 20 years"
// (unverified); nothing of another client; eXp is forbidden (wrong brokerage logo). Industry lines (disclosure, steering, unknown, language) are the
// real-estate-agent standard set, for the lawyer's read (her question 11); they are not client facts.
// Built into pack.json by: node factory/advisor/pack/build-pack.mjs factory/advisor/packs/vtv/source.mjs factory/advisor/packs/vtv/pack.json
const LIVE = (page) => ({ kind: 'page', ref: 'E:/Francine & Eli/site-checks/valleytovalleyrealty.com/snapshots/2026-10-22/pages/' + page + '/body.html', date: '2026-10-22' });
const FACTS = (row, date) => ({ kind: 'page', ref: 'clients/vtv/facts.md row "' + row + '"', date });
const IND = { kind: 'industry', ref: 'docs/advisor/R2-design.md sections 5.5 and 17 (real-estate-agent standard lines; lawyer read pending, her question 11)', date: '2026-11-26' };
const CITIES = ['Dublin', 'Elk Grove', 'Fremont', 'Lathrop', 'Livermore', 'Manteca', 'Milpitas', 'Pleasanton', 'San Jose', 'San Ramon', 'Tracy'];

export default {
  meta: {
    schema: 'omnikom-advisor-pack/1', pack: 'vtv', client: 'vtv', industry: 'real-estate-agent', version: '0.1.0', locales: ['en'],
    domain: 'valleytovalleyrealty.com', allowedHosts: [], report: false,
    forbidden: ['eXp', 'EXP Realty', 'Luxury Presence', 'ELEV8', 'Eli'],
    note: 'Preview first, then the owner\'s go and Francine\'s OK (the head\'s ruling 2). Session report OFF until her privacy page covers it (the owner, 2026-11-26 20:50).',
  },
  facts: {
    name: { value: 'Valley To Valley Realty', required: true, source: FACTS('Name and spelling', '2026-10-17') },
    agent: { value: 'Francine Masudi', required: true, source: FACTS('Name and spelling', '2026-10-17') },
    role: { value: 'Real Estate Advisor', required: false, source: FACTS('Role shown on her site', '2026-10-17') },
    brokerage: { value: 'Xpert Home Realty', required: true, source: FACTS('Brokerage', '2026-10-20') },
    email: { value: 'francine@valleytovalleyrealty.com', required: false, source: FACTS('Email', '2026-10-17') },
    cities: { value: CITIES.join(', '), required: true, source: FACTS('Cities served', '2026-10-22') },
    phone: { value: null, required: false, why: 'two numbers, (209) 513-3323 on her site and 925-744-7653 on her Google listing; which is hers is unanswered (facts.md "Phone")' },
    address: { value: null, required: false, why: 'Roseville on the footer, Newark on her agent page; unanswered (facts.md "Office address")' },
    licence: { value: null, required: false, why: 'CA DRE 02236450 is client-stated in her footer; the DRE lookup is NOT DONE (facts.md "Licence number"; DEF-03 placeholder rule)' },
    broker: { value: null, required: false, why: 'her responsible broker at Xpert Home Realty is not named (question 2)' },
    mls: { value: null, required: false, why: 'questions 4 and 5' },
    spanish: { value: null, required: false, why: 'B7 open' },
  },
  prices: [],
  forms: [
    { id: 'contact', kind: 'form', path: '/contact-us/', fields: { intent: 'interest', city: 'message', timeline: 'message' } },
    { id: 'homeValue', kind: 'form', path: '/home-valuation/', fields: { city: 'address' } },
    { id: 'cashOffer', kind: 'form', path: '/sell/', fields: {} },
    { id: 'booking', kind: 'booking', url: null, note: 'her Calendly, when her answer arrives (the head\'s ruling 3); until then booking goes to the contact form' },
  ],
  slots: [
    { name: 'intent', type: 'enum', values: ['buy', 'sell', 'both'], form: 'interest' },
    { name: 'city', type: 'place', values: CITIES },
    { name: 'timeline', type: 'enum', values: ['within 3 months', '3 to 6 months', '6 to 12 months', 'just looking'] },
    { name: 'name', type: 'name', reflect: false, form: 'name' },
  ],
  claims: [
    { id: 'greet', text: 'Hi! I\'m the website assistant for {{fact.name}}. I can help you get started buying or selling a home in the cities {{fact.agent}} serves, or ask her for a home value.', source: LIVE('home') },
    { id: 'help', text: 'I can tell you which cities {{fact.agent}} serves, help you start buying or selling, and pass a message to her with the contact form. For anything I can\'t answer, the form reaches her directly.', source: IND },
    { id: 'about', text: '{{fact.name}} is {{fact.agent}}\'s real estate business, with {{fact.brokerage}}. She helps people buy and sell homes from Silicon Valley and the Tri-Valley to the Central Valley.', source: LIVE('agents__francine-masudi') },
    { id: 'brokerage', text: '{{fact.agent}} works with {{fact.brokerage}}.', source: FACTS('Brokerage', '2026-10-20') },
    { id: 'area', text: '{{fact.agent}} works in {{fact.cities}}. Tell me which city you have in mind and whether you are buying or selling.', source: FACTS('Cities served', '2026-10-22') },
    { id: 'area.other', text: 'The cities {{fact.agent}} lists are {{fact.cities}}. For a place outside that list, ask her with the contact form whether she can help.', source: FACTS('Cities served', '2026-10-22') },
    { id: 'buy', text: 'Happy to help you buy. Which city are you looking in, and roughly when do you want to move? You can also send {{fact.agent}} your details with the contact form and she will follow up.', source: LIVE('buyers-guide') },
    { id: 'sell', text: 'Happy to help you sell. {{fact.agent}} can prepare a home value for you; you can ask for one with the home-value form, or tell me your city and timeline first.', source: LIVE('sellers-guide') },
    { id: 'value', text: 'I can\'t give a home value here: a value needs {{fact.agent}}\'s own review of your home. You can ask her for one with the home-value form.', source: LIVE('home-valuation') },
    { id: 'cash', text: 'You can ask for a cash offer with the request form on the Sell page, and {{fact.agent}} will get back to you.', source: LIVE('cash-offer') },
    { id: 'mortgage', text: 'There is a mortgage calculator on the site you can use for a rough monthly figure. For the purchase itself, ask {{fact.agent}} with the contact form.', source: LIVE('mortgage-calculator') },
    { id: 'listings', text: 'I can\'t search homes for sale here. Tell {{fact.agent}} what you are looking for with the contact form and she will follow up.', source: IND },
    { id: 'contact', text: 'The quickest way to reach {{fact.agent}} is the contact form; she will get back to you. You can also email her at {{fact.email}}.', source: FACTS('Email', '2026-10-17') },
    { id: 'book', text: 'Leave your details with the contact form and {{fact.agent}} will set up a time to talk with you.', source: IND },
    { id: 'unknown', text: 'I don\'t have that information. {{fact.agent}} can answer it: send her a message with the contact form and she will get back to you.', source: IND },
    { id: 'fees', text: 'I can\'t quote fees or commission; those are agreed with {{fact.agent}} directly. Ask her with the contact form.', source: IND },
    { id: 'steering', text: 'I can\'t describe who lives in an area or say which area suits a particular household. {{fact.agent}} can point you to public information so you can decide for yourself; ask her with the contact form.', source: IND },
    { id: 'whoami', text: 'I\'m an automated assistant on the {{fact.name}} website, not {{fact.agent}}. I answer simple questions and pass your message to her with the contact form.', source: IND },
    { id: 'language', text: 'I can only answer in English for now. You can still send a message with the contact form.', source: IND },
    { id: 'privacy', text: 'Please don\'t type personal details such as your email or phone number here. The contact form is the safe place for them.', source: IND },
    { id: 'thanks', text: 'You\'re welcome. If anything else comes up, I\'m here, or you can reach {{fact.agent}} with the contact form.', source: IND },
    { id: 'bye', text: 'Thanks for stopping by. Good luck with your move!', source: IND },
  ],
  intents: [
    { id: 'greet', answer: 'greet', next: ['buy', 'sell', 'area'], phrasings: ['hi', 'hello', 'hey there', 'good morning', 'good afternoon', 'hi is anyone there', 'hello can you help me', 'yo'] },
    { id: 'help', answer: 'help', next: ['buy', 'sell', 'contact'], form: 'contact', phrasings: ['what can you do', 'how can you help me', 'help', 'what do you know', 'what can i ask you', 'menu', 'options'] },
    { id: 'about', answer: 'about', next: ['area', 'contact'], phrasings: ['who is francine', 'tell me about francine', 'about you', 'who are you guys', 'tell me about valley to valley realty', 'what is valley to valley realty', 'who runs this business', 'about the agent'] },
    { id: 'brokerage', answer: 'brokerage', next: ['about'], phrasings: ['what brokerage are you with', 'which brokerage', 'who is your brokerage', 'are you with a brokerage', 'what company does francine work for', 'is this xpert home realty'] },
    { id: 'area', answer: 'area', next: ['buy', 'sell'], phrasings: ['what areas do you serve', 'which cities do you cover', 'where do you work', 'do you cover my area', 'service area', 'what cities', 'where are you located', 'do you work in the bay area', 'do you serve the tri valley', 'do you work in the central valley', ...CITIES.map((c) => 'do you work in ' + c.toLowerCase()), ...CITIES.map((c) => 'homes in ' + c.toLowerCase())] },
    { id: 'area.other', answer: 'area.other', next: ['contact'], form: 'contact', phrasings: ['do you cover oakland', 'do you work in sacramento', 'do you cover san francisco', 'can you help in stockton', 'do you serve modesto', 'do you work in berkeley', 'what about hayward'] },
    { id: 'buy', answer: 'buy', next: ['area', 'mortgage', 'contact'], form: 'contact', phrasings: ['i want to buy a house', 'we want to buy a home', 'looking to buy', 'help me buy a home', 'first time buyer', 'buying a house', 'we are looking for a home', 'i am interested in buying', 'how do i buy a house with you', 'we want to buy in tracy', 'looking for a house in fremont'] },
    { id: 'sell', answer: 'sell', next: ['value', 'cash', 'contact'], form: 'homeValue', phrasings: ['i want to sell my house', 'we want to sell our home', 'help me sell', 'selling my home', 'list my house', 'how do i sell my house', 'thinking about selling', 'can you sell my home', 'i need a listing agent'] },
    { id: 'value', answer: 'value', next: ['sell', 'contact'], form: 'homeValue', phrasings: ['what is my house worth', 'how much is my home worth', 'home value', 'home valuation', 'what is my home worth in fremont', 'estimate my home', 'can you value my house', 'appraisal', 'what would my house sell for', 'free home valuation'] },
    { id: 'cash', answer: 'cash', next: ['sell', 'contact'], form: 'cashOffer', phrasings: ['cash offer', 'can i get a cash offer', 'do you buy houses for cash', 'sell my house fast for cash', 'cash for my home', 'quick cash sale'] },
    { id: 'mortgage', answer: 'mortgage', next: ['buy', 'contact'], form: 'contact', phrasings: ['mortgage calculator', 'how much can i afford', 'monthly payment', 'mortgage rates', 'can you help with a loan', 'do you do mortgages', 'interest rates', 'pre approval'] },
    { id: 'listings', answer: 'listings', next: ['buy', 'contact'], form: 'contact', phrasings: ['what homes do you have for sale', 'show me listings', 'houses for sale', 'any homes available', 'do you have properties', 'search homes', 'what is on the market', 'open houses'] },
    { id: 'contact', answer: 'contact', next: ['book'], form: 'contact', phrasings: ['how do i contact you', 'how can i reach francine', 'contact', 'get in touch', 'i want to talk to someone', 'can i speak to a person', 'talk to a human', 'talk to francine', 'send a message', 'email address', 'what is your email'] },
    { id: 'book', answer: 'book', next: ['contact'], form: 'contact', phrasings: ['book a call', 'schedule a consultation', 'can we meet', 'book an appointment', 'set up a meeting', 'schedule a showing', 'when are you available'] },
    { id: 'phone', answer: 'unknown', next: ['contact'], form: 'contact', phrasings: ['what is your phone number', 'phone number', 'can i call you', 'number to call', 'what number do i call', 'call francine'] },
    { id: 'address', answer: 'unknown', next: ['contact'], form: 'contact', phrasings: ['where is your office', 'office address', 'what is your address', 'can i visit your office', 'office hours'] },
    { id: 'licence', answer: 'unknown', next: ['contact'], form: 'contact', phrasings: ['what is your license number', 'dre number', 'are you licensed', 'licence number', 'what is her license number', 'is francine licensed'] },
    { id: 'broker', answer: 'unknown', next: ['contact'], form: 'contact', phrasings: ['who is your broker', 'responsible broker', 'broker of record', 'who is the broker'] },
    { id: 'fees', answer: 'fees', next: ['contact'], form: 'contact', phrasings: ['what is your commission', 'how much do you charge', 'what are your fees', 'commission rate', 'do you charge a fee', 'how much does it cost to sell'] },
    { id: 'steering', answer: 'steering', next: ['area', 'contact'], form: 'contact', phrasings: ['is manteca a good area for families like ours', 'what are the demographics there', 'is it a safe neighborhood', 'who lives there', 'is it a good neighborhood for us', 'what kind of people live in tracy', 'is the area diverse', 'good schools for our kids'] },
    { id: 'whoami', answer: 'whoami', next: ['help'], form: 'contact', phrasings: ['are you francine', 'are you a real person', 'am i talking to a bot', 'is this a robot', 'are you human', 'are you ai', 'who am i talking to'] },
    { id: 'language', answer: 'language', next: ['contact'], form: 'contact', phrasings: ['hablas espanol', 'habla espanol', 'quiero comprar una casa', 'do you speak spanish', 'en espanol por favor', 'necesito ayuda'] },
    { id: 'privacy', answer: 'privacy', next: ['contact'], phrasings: ['my email is', 'my phone number is', 'here is my number', 'call me at', 'do you keep my data', 'is this chat private'] },
    { id: 'thanks', answer: 'thanks', next: [], form: 'contact', phrasings: ['thanks', 'thank you', 'thanks a lot', 'great thanks', 'appreciate it', 'perfect thank you'] },
    { id: 'bye', answer: 'bye', next: [], phrasings: ['bye', 'goodbye', 'see you', 'that is all', 'nothing else', 'have a good day'] },
    { id: 'unknown', answer: 'unknown', next: ['contact'], form: 'contact', phrasings: ['what is the weather', 'tell me a joke', 'who won the game', 'what is the capital of france'] },
  ],
  cues: [
    { pattern: '\\b(?:worth|valu(?:e|ation)|apprais)', flags: 'i', intent: 'value', delta: 0.15 },
    { pattern: '\\b(?:commission|fees?)\\b', flags: 'i', intent: 'fees', delta: 0.15 },
    { pattern: '\\b(?:demographic|safe|crime|famil(?:y|ies) like|kind of people|diverse|religio|ethnic)', flags: 'i', intent: 'steering', delta: 0.25 },
    { pattern: '\\b(?:espa[nñ]ol|hablas?|quiero|necesito|casa)\\b', flags: 'i', intent: 'language', delta: 0.3 },
    { pattern: '\\b(?:licen[cs]e|dre)\\b', flags: 'i', intent: 'licence', delta: 0.15 },
    { pattern: '\\b(?:phone|call (?:you|her|francine)|number to call)\\b', flags: 'i', intent: 'phone', delta: 0.15 },
    // "are you francine" is one word after the stop words, the same word "about" matches; the question is the disclosure (V7)
    { pattern: '\\bare you (?:francine|real|a real person|human|a human|a person|a bot|a robot|ai|an ai)\\b', flags: 'i', intent: 'whoami', delta: 0.2 },
  ],
  refusals: { unknown: 'unknown', steering: 'steering', fees: 'fees', language: 'language', disclosure: 'whoami' },
  // the chips under the first answer and under a reply the engine could not match
  lists: { defaultMenu: ['buy', 'sell', 'area'], fallbackMenu: ['buy', 'sell', 'contact'] },
};

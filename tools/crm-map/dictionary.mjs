// crm-map synonym dictionary. DATA ONLY: no functions, no imports. Written 2026-10-29.
//
// Provenance. Every header below is from memory of common CRM export files. None was re-read from a vendor page
// today (no browser access in this session), so none is a verified fact. A tag says where the header is commonly seen:
//   (HubSpot)         a contact property label in a HubSpot contacts export / import file
//   (Google Contacts) a header of the Google Contacts CSV export
//   (Follow Up Boss)  a people field in a Follow Up Boss export
//   // generic        plain words any sheet might use; no vendor claim
// kvCORE: no header is attributed to it, because I am not sure of its export headers.
// The lead verifies the tagged ones before they are shown to a client.

// Our fields, in the order the wizard lists them (leads table, 13-DATA-MODEL.md section 6).
export const LEAD_FIELDS = [
  'name', 'email', 'phone', 'form', 'page_path', 'flow', 'cta', 'status', 'created_at',
  'answers.address', 'answers.budget', 'answers.beds', 'answers.timing', 'answers.message',
];

// Glued, lower-case, letters and digits only -> expansion (already in normalised form). Applied token by token,
// also to runs of up to three tokens glued together, so "E-mail" (e + mail), "First Name" (first + name) and
// "Zip Code" all match.
export const ABBREVIATIONS = {
  // phone
  ph: 'phone', tel: 'phone', telephone: 'phone', mob: 'phone', mobile: 'phone', cell: 'phone', cellphone: 'phone', // generic
  mobilephone: 'phone', phonenumber: 'phone', phoneno: 'phone', telno: 'phone', // generic
  mobilenumber: 'phone', cellnumber: 'phone', telephonenumber: 'phone', // generic
  // email
  email: 'email', emailaddress: 'email', emailaddr: 'email', // generic ("email" is listed so e + mail glues to it)
  // first / last name
  fname: 'first name', firstname: 'first name', givenname: 'first name', forename: 'first name', // generic; givenname (Google Contacts)
  lname: 'last name', lastname: 'last name', surname: 'last name', familyname: 'last name', // generic; familyname (Google Contacts)
  // address pieces
  zip: 'postal code', zipcode: 'postal code', postcode: 'postal code', postal: 'postal code', postalcode: 'postal code', // generic; postalcode (HubSpot)
  address1: 'street', addressline1: 'street', // generic; address1 also begins Google Contacts "Address 1 - Street"
  // when it was created
  createdat: 'created at', dateadded: 'created at', createddate: 'created at', createdon: 'created at', // generic
  createdate: 'created at', // HubSpot "Create Date"
  // which journey / where it came from
  src: 'flow', source: 'flow', leadsource: 'flow', // generic; "Source" also Follow Up Boss
  // status
  leadstatus: 'status', // HubSpot "Lead Status"
  // free text
  notes: 'message', comments: 'message', message: 'message', note: 'message', comment: 'message', // generic; "Notes" Google Contacts
};

// Expanded only when the WHOLE header is exactly this word. As a loose token these are too ambiguous
// ("First Contact", "Close Date", "Email Addr", "Direct Mail"), so "first name contact" etc. never happens.
export const WHOLE_HEADER = {
  first: 'first name', last: 'last name', // generic
  date: 'created at', created: 'created at', dt: 'created at', // generic
  st: 'street', addr: 'street', // generic (the brief says st -> street; many sheets use ST for state, so the wizard shows the score)
  mail: 'email', // generic
  stage: 'status', // Follow Up Boss "Stage"; HubSpot "Lifecycle Stage" is a synonym below
};

// Tokens that name one part of a composite. A header carrying one of these only matches a field whose own
// synonym carries the same ones, so "First Name" can never be scored as the whole `name`, nor "City" as `address`.
export const PART_TOKENS = ['first', 'last', 'middle', 'street', 'city', 'state', 'postal', 'region', 'province']; // generic

// Tokens that mean the column is about someone or something else ("Company Name", "Contact owner").
export const DISQUALIFIERS = ['company', 'business', 'organisation', 'organization', 'org', 'account', 'owner', 'agent', 'assigned', 'employer', 'spouse', 'partner']; // generic

// One entry per OUR field. accepts = the value types a column for it may hold (text, number, email, phone, date; null = anything).
export const FIELDS = {
  name: {
    accepts: ['text'],
    synonyms: [
      'name', // Google Contacts "Name"
      'full name', 'contact name', 'lead name', 'client name', 'customer name', 'display name', // generic
    ],
  },
  email: {
    accepts: ['email'],
    synonyms: [
      'email', 'email address', 'e-mail', 'primary email', 'work email', // generic ("Email" HubSpot, Follow Up Boss)
      'e-mail 1 - value', // Google Contacts
    ],
  },
  phone: {
    accepts: ['phone'],
    synonyms: [
      'phone', 'phone number', 'mobile phone number', // HubSpot "Phone Number", "Mobile Phone Number"
      'phone 1 - value', // Google Contacts
      'telephone', 'mobile', 'cell', 'cell phone', 'primary phone', 'contact number', // generic
    ],
  },
  form: {
    accepts: ['text', 'number'],
    synonyms: ['form', 'form name', 'form id', 'lead form', 'form submitted'], // generic
  },
  page_path: {
    accepts: ['text'],
    synonyms: ['page path', 'path', 'page', 'page url', 'url', 'landing page', 'source page', 'source url'], // generic
  },
  flow: {
    accepts: ['text', 'number'],
    synonyms: [
      'flow', 'journey', // generic
      'source', // Follow Up Boss "Source"
      'lead source', 'src', // generic
      'original source', // HubSpot "Original Source"
    ],
  },
  cta: {
    accepts: ['text'],
    synonyms: ['cta', 'call to action', 'button', 'button label', 'cta label'], // generic
  },
  status: {
    accepts: ['text', 'number'],
    synonyms: [
      'status', 'lead status', // HubSpot "Lead Status"
      'lifecycle stage', // HubSpot "Lifecycle Stage"
      'stage', // Follow Up Boss "Stage"
      'lead stage', 'lifecycle status', // generic
    ],
  },
  created_at: {
    accepts: ['date'],
    synonyms: [
      'created at', 'created', 'date', 'date added', 'created date', 'date created', // generic
      'create date', // HubSpot "Create Date"
      'submitted', 'submitted at', 'received', 'received at', 'timestamp', // generic
    ],
  },
  'answers.address': {
    accepts: ['text'],
    synonyms: [
      'address', 'property address', 'home address', 'full address', // generic
      'street address', // HubSpot "Street Address" (a lone street column maps here; with city/state/zip present it is split instead)
      'address 1', 'address line 1', // generic
    ],
  },
  'answers.budget': {
    accepts: ['number', 'text'],
    synonyms: ['budget', 'price range', 'max price', 'max budget', 'budget range', 'price'], // generic
  },
  'answers.beds': {
    accepts: ['number', 'text'],
    synonyms: ['beds', 'bedrooms', 'bedroom', 'bed', 'br', 'number of bedrooms', 'min beds'], // generic
  },
  'answers.timing': {
    accepts: ['text', 'date', 'number'],
    synonyms: ['timing', 'timeframe', 'time frame', 'timeline', 'move timeline', 'when to move', 'purchase timeline'], // generic
  },
  'answers.message': {
    accepts: null,
    synonyms: [
      'message', // HubSpot "Message" (as I recall it)
      'notes', // Google Contacts "Notes"
      'comments', 'note', 'additional info', 'additional comments', 'details', 'inquiry', 'lead notes', // generic
    ],
  },
  // ---- parts of a composite (scored like fields, used only by the split logic) ----
  'name.first': {
    accepts: ['text'],
    synonyms: ['first name', 'given name', 'forename', 'first'], // First Name (HubSpot, Follow Up Boss), Given Name (Google Contacts)
  },
  'name.last': {
    accepts: ['text'],
    synonyms: ['last name', 'family name', 'surname', 'last'], // Last Name (HubSpot, Follow Up Boss), Family Name (Google Contacts)
  },
  'answers.address.street': {
    accepts: ['text'],
    synonyms: [
      'street', 'street address', // HubSpot "Street Address"
      'address 1 - street', // Google Contacts
      'address', 'address 1', 'address line 1', 'addr', // generic (a bare "Address" next to City/State/Zip is the street)
    ],
  },
  'answers.address.city': {
    accepts: ['text'],
    synonyms: [
      'city', // HubSpot "City"
      'address 1 - city', // Google Contacts
      'town', // generic
    ],
  },
  'answers.address.state': {
    accepts: ['text'],
    synonyms: [
      'state', 'state/region', // HubSpot "State/Region"
      'address 1 - region', // Google Contacts
      'region', 'province', // generic
    ],
  },
  'answers.address.postal_code': {
    accepts: ['text', 'number'],
    synonyms: [
      'postal code', // HubSpot "Postal Code"
      'address 1 - postal code', // Google Contacts
      'zip', 'zip code', 'postcode', // generic
    ],
  },
};

// Composites. A split is proposed only when every `required` part and at least `min` parts are found.
// transform is the word a template column uses for the part.
export const PARTS = {
  name: {
    min: 2,
    required: ['first', 'last'],
    parts: [
      { transform: 'first', key: 'name.first' },
      { transform: 'last', key: 'name.last' },
    ],
  },
  'answers.address': {
    min: 2,
    required: ['street'],
    parts: [
      { transform: 'street', key: 'answers.address.street' },
      { transform: 'city', key: 'answers.address.city' },
      { transform: 'state', key: 'answers.address.state' },
      { transform: 'postal_code', key: 'answers.address.postal_code' },
    ],
  },
};

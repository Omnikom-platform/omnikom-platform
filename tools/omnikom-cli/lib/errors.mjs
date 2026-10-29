// The two ways a command stops before it has an answer. Everything else is a result with ok true or false.
//   Usage   -> exit 2 (the arguments are wrong; fix the command line)
//   Blocked -> exit 3 (a key is missing by name, or the target is refused; `unblock` says what would change that)
export class Usage extends Error {
  constructor(message) { super(message); this.name = 'Usage'; }
}
export class Blocked extends Error {
  constructor(message, unblock = '') { super(message); this.name = 'Blocked'; this.unblock = unblock; }
}

// exit 0 and writes nothing: that is not done
import { begin, end } from './fx.mjs';

const id = begin();
console.log('all good, I promise');
end(id);

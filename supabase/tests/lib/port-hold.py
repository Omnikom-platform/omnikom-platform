# supabase/tests/lib/port-hold.py: for supabase/tests/port-probe.mjs. Holds local port P the way a psql call does: a plain client socket
# bound to 127.0.0.1:P WITHOUT SO_REUSEADDR (node's net.connect sets it, which is why a node holder cannot show the conflict), connected to
# the listener on TARGET.
#   python3 port-hold.py P TARGET est|tw [SECONDS]
#   est: stays ESTABLISHED for SECONDS (default 60)   tw: closes first, so P stays in TIME_WAIT for the kernel's 60 s
import socket, sys, time

port, target, mode = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
seconds = float(sys.argv[4]) if len(sys.argv) > 4 else 60
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(('127.0.0.1', port))
s.connect(('127.0.0.1', target))
if mode == 'tw':
    s.close()
print('held', flush=True)
time.sleep(seconds)

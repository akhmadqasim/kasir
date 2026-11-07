#!/bin/sh
# Apply the printer rule (70-kasir-printer.rules) to printers already plugged
# in, so the first receipt works without unplugging them. Never fail the
# install over it: on the next plug-in the rule applies anyway.
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=usbmisc --action=change 2>/dev/null || true

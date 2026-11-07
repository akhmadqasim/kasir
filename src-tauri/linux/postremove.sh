#!/bin/sh
# Forget the printer rule (70-kasir-printer.rules) once the package removed it.
udevadm control --reload-rules 2>/dev/null || true

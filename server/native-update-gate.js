'use strict';

class NativeUpdateGate {
  constructor() {
    this.shutdownPending = false;
    this.inFlightMutations = 0;
  }

  tryBeginMutation() {
    if (this.shutdownPending) return null;
    this.inFlightMutations++;
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      this.inFlightMutations--;
    };
  }

  tryBeginShutdown() {
    if (this.shutdownPending || this.inFlightMutations > 0) return false;
    this.shutdownPending = true;
    return true;
  }

  cancelShutdown() {
    this.shutdownPending = false;
  }
}

module.exports = { NativeUpdateGate };

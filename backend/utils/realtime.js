let ioInstance = null;

function setSocketServer(io) {
  ioInstance = io;
}

function emitLoanUpdated(payload) {
  if (!ioInstance) return;
  ioInstance.emit('loanUpdated', payload);
}

function emitBalanceUpdated(payload) {
  if (!ioInstance) return;
  ioInstance.emit('balanceUpdated', payload);
}

module.exports = {
  setSocketServer,
  emitLoanUpdated,
  emitBalanceUpdated
};

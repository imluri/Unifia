// Pure toast-list reducer. The store wraps these with id generation + state set;
// kept I/O-free so it is unit-testable with node:test (CommonJS).
function addToast(list, toast, id) {
  return [...list, { id, type: toast.type || 'info', message: String(toast.message || '') }];
}

function removeToast(list, id) {
  return list.filter((t) => t.id !== id);
}

module.exports = { addToast, removeToast };

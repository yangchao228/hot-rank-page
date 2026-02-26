function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatIsoToMMDDHHmm(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

module.exports = {
  formatIsoToMMDDHHmm
};

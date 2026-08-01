const MIN_VIEWS = 650;
const VIEW_SPREAD = 851;

export function viewBaseline(key: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619);
  }
  return MIN_VIEWS + (hash >>> 0) % VIEW_SPREAD;
}

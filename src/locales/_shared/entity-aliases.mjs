// Match ONLY supplied registry-derived canonical entity IDs. Never guess aliases.
// This helper does not query Supabase or alter the existing Search ranking.
export function normalizeAlias(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f]/g,'') // Arabic optional diacritics
    .replace(/[’‘`´]/g,"'")
    .replace(/[\u2010-\u2015_-]/g,' ')
    .replace(/\s+/gu,' ').trim();
}
export function createAliasIndex(entities) {
  if (!Array.isArray(entities)) throw new TypeError('entities_must_be_array');
  const map=new Map();
  for(const entity of entities) {
    if(!entity || !entity.canonical_id || !entity.entity_type) throw new Error('missing_canonical_identity');
    const aliases=[entity.canonical_name, ...(Array.isArray(entity.aliases)?entity.aliases:[])];
    for(const raw of aliases){
      const key=normalizeAlias(raw);
      if(!key)continue;
      const bucket=map.get(key)||new Map();
      bucket.set(`${entity.entity_type}:${entity.canonical_id}`,entity);
      map.set(key,bucket);
    }
  }
  return map;
}
export function resolveAlias(index, raw, expectedType=null) {
  const bucket=index.get(normalizeAlias(raw));
  if(!bucket)return {status:'not_found',entity:null};
  const matches=[...bucket.values()].filter(e=>!expectedType || e.entity_type===expectedType);
  if(!matches.length)return {status:'not_found',entity:null};
  if(matches.length>1)return {status:'ambiguous',entity:null,candidates:matches.map(x=>({type:x.entity_type,id:x.canonical_id}))};
  return {status:'resolved',entity:matches[0]};
}
// Russian "двушка" means two rooms in one convention, not guaranteed 2BR in UAE.
export function classifyRoomPhraseRu(input) {
  const t=normalizeAlias(input);
  if(/(?:двушка|двухкомнатн\w*)/u.test(t))return {status:'clarify_room_vs_bedroom',bedrooms:null};
  const m=t.match(/(?:^|\s)([1-9])\s*(?:br|bedrooms?)(?=\s|$)/u) || t.match(/(?:^|\s)([1-9])\s*спальн\w*/u);
  return m ? {status:'resolved',bedrooms:Number(m[1])} : {status:'not_found',bedrooms:null};
}

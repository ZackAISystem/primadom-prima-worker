/**
 * Prima RU native language adapter V1 — deterministic, no LLM translation.
 * Returns canonical intent/filter objects for integration with EXISTING Core.
 * Does not perform independent Search, persistence, leads or network calls.
 * EN baseline and original requests are NEVER modified.
 */
const EMIRATES = Object.freeze([
  {key:'dubai', names:['дубай','дубае','дубая','dubai']},
  {key:'abu-dhabi',names:['абу-даби','абу даби','абудаби','abu dhabi']},
  {key:'sharjah',names:['шарджа','шардже','шарджи','sharjah']},
  {key:'ajman',names:['аджман','аджмане','ajman']},
  {key:'ras-al-khaimah',names:['рас-эль-хайма','рас эль хайма','рас-аль-хайма','ras al khaimah']},
  {key:'fujairah',names:['фуджейра','фуджейре','фуджайра','fujairah']},
  {key:'umm-al-quwain',names:['умм-эль-кувейн','умм аль кувейн','umm al quwain']}
]);
const TYPES=Object.freeze([
  {key:'apartment',names:['квартир','апартамент','апартаментов','апартаменты','квартира','квартиры','квартиру','апарт']},
  {key:'villa',names:['вилл','вилла','виллы','виллу']},
  {key:'townhouse',names:['таунхаус','таунхаусы','таунхаусов','таунхауса']},
  {key:'penthouse',names:['пентхаус','пентхаусы','пентхаусов']},
  {key:'duplex',names:['дуплекс','дуплексы','дуплексов']},
  {key:'studio',names:['студия','студии','студий','студию']}
]);
const CANDIDATE_ENTITY_ALIASES=Object.freeze({
  // Exact aliases only. The actual entity resolver validates the canonical entity.
  'эмаар':'Emaar Properties','имар':'Emaar Properties',
  'дубай хиллс':'Dubai Hills Estate','дубай хиллс эстейт':'Dubai Hills Estate',
  'дубай марина':'Dubai Marina','джумейра виладж сёркл':'Jumeirah Village Circle',
  'жвс':'Jumeirah Village Circle'
});
const normalize = text => String(text||'').normalize('NFKC')
  .replace(/[\u064B-\u065F]/g,'').replace(/ё/gi,'е')
  .toLowerCase().replace(/\s+/g,' ').trim();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const hasPhrase=(q,p)=>new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(normalize(p))}(?=$|[^\\p{L}\\p{N}])`,'u').test(q);
const pick=(q,variants)=>variants.filter(x=>x.names.some(alias=>hasPhrase(q,alias))).map(x=>x.key);
const DIGITS = Object.freeze({
  'одна':1,'один':1,'одну':1,'две':2,'два':2,'двух':2,'три':3,'трех':3,'четыре':4,
  'пять':5,'шесть':6,'семь':7,'восемь':8,'девять':9,'десять':10
});
function parseBedrooms(q){
  // JS \b does not recognise Cyrillic as Unicode word characters.
  const explicit=q.match(/(?:^|[^\p{L}\p{N}])([0-9]{1,2})\s*[- ]?(?:br|bedrooms?|спальн[\p{L}]*|комнат[\p{L}]*)(?=$|[^\p{L}])/u);
  if(explicit)return Number(explicit[1]);
  for(const [word,quantity] of Object.entries(DIGITS)){
    const re=new RegExp(`(?:^|[^\\p{L}])${escapeRe(word)}\\s+(?:спальн[\\p{L}]*|комнат[\\p{L}]*)(?=$|[^\\p{L}])`,'u');
    if(re.test(q))return quantity;
  }
  if(/(?:^|[^\p{L}])студи[яиюй](?=$|[^\p{L}])/u.test(q))return 0;
  return null;
}
function parseBudget(q){
  // Strong lexical constraints only: avoid interpreting floor area or years as price.
  const moneyPattern=/(\d{1,3}(?:[ .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(млн|миллион(?:а|ов)?|м|тыс|тысяч(?:а|и|у|ами)?|тысячи|k|million)?\s*(?:aed|дирхам(?:а|ов|ы)?|د\.إ)?/giu;
  const results=[];
  for(const m of q.matchAll(moneyPattern)){
    const n=Number(m[1].replace(/\s/g,'').replace(/,(?=\d{3}\b)/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',','.'));
    if(!Number.isFinite(n))continue;
    const unit=normalize(m[2]||'');
    const scale=/^(?:млн|миллион|м$|million)/u.test(unit)?1_000_000:/^(?:тыс|тысяч|k$)/u.test(unit)?1_000:1;
    const amount=n*scale;
    if(!Number.isFinite(amount)||amount<100_000||amount>1_000_000_000)continue;
    const before=q.slice(Math.max(0,m.index-32),m.index);
    const after=q.slice(m.index+m[0].length,m.index+m[0].length+16);
    const context=before+' '+after;
    if(!unit && !/(?:aed|дирхам|бюджет|стоим|цен|до|от|миллион|млн|меньше|не более|около|примерно)/u.test(context))continue;
    let kind='around';
    if(/(?:не более|не выше|до|максимум|дешевле|меньше|ниже)\s*$/u.test(before)) kind='max';
    if(/(?:не менее|не ниже|от|минимум|больше|выше|свыше)\s*$/u.test(before)) kind='min';
    results.push({kind,amount});
  }
  if(results.length>=2 && /\b(?:от|между|диапазон|в пределах)\b/u.test(q)) {
    return {kind:'range',min:Math.min(results[0].amount,results[1].amount),max:Math.max(results[0].amount,results[1].amount),currency:'AED'};
  }
  const v=results[0];
  return v ? {...v,currency:'AED'} : null;
}
function detectIntent(q){
  if(/(?:не звони|не пишите|без звонк|не связывайтесь|не хочу оставлять номер|без контакт)/u.test(q))return 'contact_opt_out';
  if(/(?:позвоните|свяжитесь|хочу консультацию|оставлю номер|напишите в whatsapp|хочу связаться)/u.test(q))return 'contact_intent';
  if(/(?:не подходит|исключи|убери из списка|не советуй|отклоняю)/u.test(q))return 'decision_reject';
  if(/(?:запомни|добавь.{0,50}в избранное|добавь.{0,50}в список|в шортлист|в мой список)/u.test(q))return 'decision_shortlist';
  if(/(?:покажи еще|еще [0-9]+|следующие варианты|что еще есть)/u.test(q))return 'search_more';
  if(/(?:сравни|чем отличается|что лучше|или|vs\b|против)/u.test(q))return 'compare';
  if(/(?:похож|альтернатив|дешевле чем|раньше сдач)/u.test(q))return 'project_relation_search';
  if(/(?:застройщик|девелопер|компани[яию] строит|кто строит)/u.test(q))return 'developer_search';
  if(/(?:район|локаци[яию]|где лучше жить|сообщество)/u.test(q) && !/(?:квартир|апартамент|вилл|таунхаус)/u.test(q))return 'district_search';
  if(/(?:найди|покажи|ищу|подбери|ищем|нужн[оыа]|хочу|вариант|квартир|вилл|студию|апартамент|пентхаус|таунхаус)/u.test(q))return 'property_search';
  return 'unknown';
}
export function interpretRussianRequest(message){
  const normalized=normalize(message);
  const types=pick(normalized,TYPES);
  const emirates=pick(normalized,EMIRATES);
  const aliases=Object.fromEntries(Object.entries(CANDIDATE_ENTITY_ALIASES).filter(([alias])=>hasPhrase(normalized,alias)));
  return Object.freeze({version:'PrimaRuIntentV1',language:'ru',original:String(message||''),
    intent:detectIntent(normalized),filters:{emirates,property_types:types,
    bedrooms:parseBedrooms(normalized),budget:parseBudget(normalized)},
    entity_aliases:aliases,
    brand_mention:/(?:^|[^\p{L}])(?:прима|приме|приму|prima|prima ai)(?=$|[^\p{L}])/u.test(normalized) ? 'Prima AI' : null,
    needs_entity_resolution:Object.keys(aliases).length>0,
    // never send raw canonicalized pseudo-English text in place of user's original message
    qa_note:'canonical intents and candidate aliases are advisory; verified existing entity resolver/search remains authoritative'
  });
}
export const ruAliasPolicy = Object.freeze({
  official_names_unchanged:true, alias_for_matching_only:true,
  protected:['Prima','Prima AI','Primadom.ai','Primadom Real Estate','Thredeesh Mannambeth Karyamkandy']
});

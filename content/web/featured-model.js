import {shanghaiDate} from './time.js';
const key=item=>(item.type==='movie'?'movie':'tv')+':'+item.id;
/** Rotate within real TMDB collections by Shanghai day; never invent recommendations. */
export function selectFeatured(blocks,{date=shanghaiDate(),batch=0,limit=5}={}) {
 const day=Math.floor(Date.parse(date+'T00:00:00+08:00')/86400000)||0;
 const seen=new Set(),chosen=[];
 function take(pool,offset){
  const available=pool.filter(item=>item?.backdropPath&&item.id!=null);
  if(!available.length)return;
  for(let n=0;n<available.length;n++){
   const item=available[((offset+n)%available.length+available.length)%available.length];
   if(!seen.has(key(item))){seen.add(key(item));chosen.push(item);return;}
  }
 }
 blocks.forEach((block,index)=>{if(chosen.length<limit)take(block.items || [],day+batch+index*3);});
 const pool=blocks.flatMap(block=>block.items || []);
 while(chosen.length<limit){const before=chosen.length;take(pool,day+batch+chosen.length);if(chosen.length===before)break;}
 return chosen;
}

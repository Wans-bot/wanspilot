import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectFeatured} from '../../content/web/featured-model.js';
const blocks=Array.from({length:5},(_,b)=>({id:'block-'+b,items:Array.from({length:12},(_,i)=>({id:b*100+i,type:b%2?'tv':'movie',backdropPath:'/a.jpg'}))}));
const ids=items=>items.map(item=>item.type+':'+item.id);
test('featured recommendations change by Shanghai day and batch, remain stable within a batch',()=>{
 const a=selectFeatured(blocks,{date:'2026-11-12'});
 assert.equal(a.length,5);assert.deepEqual(ids(a),ids(selectFeatured(blocks,{date:'2026-11-12'})));
 assert.notDeepEqual(ids(a),ids(selectFeatured(blocks,{date:'2026-11-13'})));
 assert.notDeepEqual(ids(a),ids(selectFeatured(blocks,{date:'2026-11-12',batch:1})));
 assert.equal(new Set(ids(a)).size,5);
});
test('featured fallback skips missing backdrops and duplicate TV/anime identities',()=>{
 const one={id:1,type:'tv',backdropPath:'/a.jpg'};
 assert.equal(selectFeatured([{items:[one,{...one,type:'anime'},{id:2,type:'movie'}]}]).length,1);
 assert.deepEqual(selectFeatured([]),[]);
 assert.equal(selectFeatured([{items:blocks[0].items}]).length,5);
});

import {expect,test} from 'vitest';
// @ts-expect-error plain ESM build script
import {asciiSource} from '../scripts/ascii-bundle.mjs';

const samples=['/[()（）]/gu','/^(广告|Реклама)$/iu','/[১২৩৪]/g','/😀+/u','/😀/','"課堂"','"\\（a"','"\\\\（"','`模板${1}`','/[😀-😂]/u'];
const probes=['（','广告','Реклама','২','😀😀','😁','a','\\（'];

test('escaped bundle source is ASCII and means the same thing',()=>{
  for(const sample of samples){
    const escaped=asciiSource(sample) as string;
    expect(escaped).toMatch(/^[\x00-\x7f]*$/);
    const before=(0,eval)(sample),after=(0,eval)(escaped);
    if(before instanceof RegExp){
      expect(after.flags).toBe(before.flags);
      for(const probe of probes){before.lastIndex=0;after.lastIndex=0;expect(after.test(probe)).toBe(before.test(probe));}
    }else expect(after).toBe(before);
  }
});
test('ASCII source is left unchanged',()=>{
  const source='const a=/[a-z]+/g,b="\\u0433";';
  expect(asciiSource(source)).toBe(source);
});

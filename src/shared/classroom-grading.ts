export interface SystemQuestion {
  id: string; type: string; answer?: string | string[]; points?: number;
  options?: {value:string;label:string}[]; commentPrompt?: string;
}
export interface SystemGrade { questionId:string; correct:boolean|null; status:'correct'|'incorrect'; earned:number; aiComment:string }
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/^\$+|\$+$/g,'').replace(/^\\\(|\\\)$/g,'').replace(/\\(?:left|right)\b/g,'').replace(/\s+/g,'');
/** A small arithmetic parser. It executes no JavaScript and accepts no variables. */
export function numericAnswer(value: string): number | null {
  if(value.length>300)return null;
  let source=normalize(value).replace(/\\(?:times|cdot)/g,'*').replace(/\\div/g,'/').replace(/\\pi/g,'pi').replace(/π/g,'pi');
  for(let n=0;n<8;n++)source=source.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'(($1)/($2))').replace(/\\sqrt\{([^{}]+)\}/g,'sqrt($1)');
  source=source.replace(/\{/g,'(').replace(/\}/g,')');
  const tokens=source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|sqrt|pi|[()+\-*/^%]/g);
  if(!tokens||tokens.join('')!==source||tokens.length>150)return null;
  let index=0;
  const expression=():number=>{let x=term();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++];const y=term();x=op==='+'?x+y:x-y;}return x;};
  const term=():number=>{let x=unary();while(tokens[index]==='*'||tokens[index]==='/'){const op=tokens[index++];const y=unary();x=op==='*'?x*y:x/y;}return x;};
  const unary=():number=>tokens[index]==='-'?(index++,-unary()):tokens[index]==='+'?(index++,unary()):power();
  const power=():number=>{let x=primary();if(tokens[index]==='^'){index++;x=x**unary();}if(tokens[index]==='%'){index++;x/=100;}return x;};
  const primary=():number=>{const token=tokens[index++];if(token==='('){const x=expression();if(tokens[index++]!==')')throw Error();return x;}if(token==='sqrt'){if(tokens[index++]!=='(')throw Error();const x=expression();if(tokens[index++]!==')')throw Error();return Math.sqrt(x);}if(token==='pi')return Math.PI;if(!token||!/^\d|^\.\d/.test(token))throw Error();return Number(token);};
  try{const result=expression();return index===tokens.length&&Number.isFinite(result)?result:null;}catch{return null;}
}
export function gradeSystemQuestion(question: SystemQuestion, answer: string|string[]|undefined): SystemGrade {
  const points=question.points??1;
  const done=(correct:boolean,comment='系統依預先提供的答案批改'):SystemGrade=>({questionId:question.id,correct,status:correct?'correct':'incorrect',earned:correct?points:0,aiComment:comment});
  const pending=():SystemGrade=>({questionId:question.id,correct:null,status:'incorrect',earned:0,aiComment:'尚未評分：此題需要理解推理。可按「請 AI 覆核」取得評分，不會自動呼叫 AI。'});
  const given=Array.isArray(answer)?answer:answer===undefined?[]:[answer];
  const keys=Array.isArray(question.answer)?question.answer:question.answer?[question.answer]:[];
  if(question.type!=='short_answer'){
    if(!keys.length)return pending();
    const expected=keys.map(key=>{
      if(question.options?.filter(option=>option.value===key).length===1)return key;
      const matched=question.options?.filter(option=>option.label===key);return matched?.length===1?matched[0].value:key;
    }).sort();
    const actual=[...given].sort();return done(actual.length===expected.length&&actual.every((value,i)=>value===expected[i]));
  }
  const text=typeof answer==='string'?answer.trim():'';
  if(!text)return done(false,'系統批改：未作答');
  if(keys.length!==1)return pending();
  const expected=keys[0].trim();if(!expected)return pending();
  const expectedNumber=numericAnswer(expected),actualNumber=numericAnswer(text);
  if(expectedNumber!==null&&actualNumber!==null)return done(Math.abs(expectedNumber-actualNumber)<=1e-8*Math.max(Number.MIN_VALUE,Math.abs(expectedNumber),Math.abs(actualNumber)));
  const boolean=(value:string)=>['true','yes','對','正確','是'].includes(normalize(value).toLowerCase())?true:['false','no','錯','錯誤','否'].includes(normalize(value).toLowerCase())?false:null;
  const expectedBoolean=boolean(expected),givenBoolean=boolean(text);
  if(expectedBoolean!==null&&givenBoolean!==null)return done(expectedBoolean===givenBoolean);
  // Identical short expressions/terms are conclusive; alternative reasoning
  // remains ungraded instead of being incorrectly rejected or billed to AI.
  if(expected.length<=300&&normalize(expected)===normalize(text))return done(true);
  return pending();
}

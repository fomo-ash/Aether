import { OutcomeResolver } from './resolvers/outcome.resolver';

const leaf1 = { field: 'merged', operator: 'equals', expected: true };
const leaf2 = { field: 'state', operator: 'equals', expected: 'closed' };

const compAnd = { logicalOperator: 'AND', conditions: [leaf1, leaf2] };
const compOr = { logicalOperator: 'OR', conditions: [leaf1, leaf2] };

const evidenceTrueTrue = { observedState: 'closed', payload: { merged: true } };
const evidenceTrueFalse = { observedState: 'open', payload: { merged: true } };
const evidenceFalseFalse = { observedState: 'open', payload: { merged: false } };

console.log('--- TEST AND ---');
console.log(OutcomeResolver.resolve(compAnd as any, [evidenceTrueTrue], null) === 'FULFILLED' ? 'PASS' : 'FAIL');
console.log(OutcomeResolver.resolve(compAnd as any, [evidenceTrueFalse], null) === 'PENDING' ? 'PASS' : 'FAIL');

console.log('--- TEST OR ---');
console.log(OutcomeResolver.resolve(compOr as any, [evidenceTrueFalse], null) === 'FULFILLED' ? 'PASS' : 'FAIL');
console.log(OutcomeResolver.resolve(compOr as any, [evidenceFalseFalse], null) === 'PENDING' ? 'PASS' : 'FAIL');

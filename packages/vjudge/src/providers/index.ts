import codeforces from './codeforces';
import csgoj from './csgoj';
import hduoj from './hduoj';
import kattis from './kattis';
import luogu from './luogu';
import poj from './poj';
import spoj from './spoj';
import uoj from './uoj';

const vjudge: Record<string, any> = {
    codeforces, csgoj, hduoj, kattis, luogu, poj, spoj, uoj,
};
export default vjudge;

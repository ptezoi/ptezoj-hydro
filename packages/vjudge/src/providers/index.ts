import codeforces from './codeforces';
import csgoj from './csgoj';
import hduoj from './hduoj';
import {
    BZOJ as bzoj, HUSTOJ as hustoj, XJOI as xjoi, YBT as ybt,
} from './hustoj';
import kattis from './kattis';
import luogu from './luogu';
import poj from './poj';
import spoj from './spoj';
import uoj from './uoj';

const vjudge: Record<string, any> = {
    codeforces, csgoj, hduoj, kattis, luogu, poj, spoj, uoj, hustoj, bzoj, xjoi, ybt,
};
export default vjudge;

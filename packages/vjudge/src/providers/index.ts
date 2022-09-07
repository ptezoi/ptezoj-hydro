import codeforces from './codeforces';
import csgoj from './csgoj';
import hduoj from './hduoj';
import loj from './loj';
import luogu from './luogu';
import poj from './poj';
import spoj from './spoj';
import uoj from './uoj';

declare module 'hydrooj/src/interface' {
    interface HydroGlobal {
        vjudge: typeof vjudge;
    }
}

const vjudge: Record<string, any> = {
    codeforces, csgoj, hduoj, loj, luogu, poj, spoj, uoj,
};
global.Hydro.vjudge = vjudge;
export = vjudge;

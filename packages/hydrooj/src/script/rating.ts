/* eslint-disable simple-import-sort/imports */
/* eslint-disable no-cond-assign */
/* eslint-disable no-await-in-loop */
import { NumericDictionary, unionWith } from 'lodash';
import { FilterQuery } from 'mongodb';
import Schema from 'schemastery';
import { Tdoc, Udoc } from '../interface';
import difficultyAlgorithm from '../lib/difficulty';
import rating from '../lib/rating';
import { PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import domain from '../model/domain';
import record from '../model/record';
import problem from '../model/problem';
import UserModel from '../model/user';
import db from '../service/db';

export const description = 'Calculate rp of a domain, or all domains';

type ND = NumericDictionary<number>;

interface RpDef {
    run(domainIds: string[], udict: ND, report: Function): Promise<void>;
    hidden: boolean;
    base: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { log, max, min } = Math;

export const RpTypes: Record<string, RpDef> = {
    problem: {
        async run(domainIds, udict, report) {
            const problems = await problem.getMulti('', { domainId: { $in: domainIds }, nAccept: { $gt: 0 }, hidden: false }).toArray();
            if (problems.length) await report({ message: `Found ${problems.length} problems in ${domainIds[0]}` });
            for (const pdoc of problems) {
                const nPages = Math.floor(
                    (await problem.getMultiStatus(
                        pdoc.domainId,
                        {
                            docId: pdoc.docId,
                            rid: { $ne: null },
                            uid: { $ne: pdoc.owner },
                        },
                    ).count() + 99) / 100,
                );
                pdoc.difficulty = pdoc.difficulty || difficultyAlgorithm(pdoc.nSubmit, pdoc.nAccept) || 5;
                const p = pdoc.difficulty / (Math.sqrt(Math.sqrt(pdoc.nAccept)) + 1) / 10;
                for (let page = 1; page <= nPages; page++) {
                    const psdocs = await problem.getMultiStatus(
                        pdoc.domainId, { docId: pdoc.docId, rid: { $ne: null } },
                    ).limit(100).skip((page - 1) * 100).project({ rid: 1, uid: 1 }).toArray();
                    const rdict = await record.getList(pdoc.domainId, psdocs.map((psdoc) => psdoc.rid));
                    for (const psdoc of psdocs) {
                        if (rdict[psdoc.rid.toHexString()]) {
                            const rp = rdict[psdoc.rid.toHexString()].score * p;
                            udict[psdoc.uid] = (udict[psdoc.uid] || 0) + rp;
                        }
                    }
                }
                udict[pdoc.owner] = (udict[pdoc.owner] || 0) + pdoc.difficulty;
            }
            for (const key in udict) udict[key] /= 10;
        },
        hidden: false,
        base: 0,
    },
    contest: {
        async run(domainIds, udict, report) {
            const contests: Tdoc<30>[] = await contest.getMulti('', { domainId: { $in: domainIds }, rated: true })
                .limit(10).toArray() as any;
            if (contests.length) await report({ message: `Found ${contests.length} contests in ${domainIds[0]}` });
            for (const tdoc of contests.reverse()) {
                const start = Date.now();
                const cursor = contest.getMultiStatus(tdoc.domainId, {
                    docId: tdoc.docId,
                    journal: { $ne: null },
                }).sort(contest.RULES[tdoc.rule].statusSort);
                if (!await cursor.count()) continue;
                const rankedTsdocs = await contest.RULES[tdoc.rule].ranked(tdoc, cursor);
                const users = rankedTsdocs.map((i) => ({ uid: i[1].uid, rank: i[0], old: udict[i[1].uid] }));
                // FIXME sum(rating.new) always less than sum(rating.old)
                for (const udoc of rating(users)) udict[udoc.uid] = udoc.new;
                await report({
                    case: {
                        status: STATUS.STATUS_ACCEPTED,
                        message: `Contest ${tdoc.title} finished`,
                        time: Date.now() - start,
                        memory: 0,
                        score: 0,
                    },
                });
            }
            for (const key in udict) udict[key] = max(1, udict[key] / 4 - 375);
        },
        hidden: false,
        base: 1500,
    },
    delta: {
        async run(domainIds, udict) {
            const dudocs = unionWith(
                await domain.getMultiUserInDomain(
                    '', { domainId: { $in: domainIds }, rpdelta: { $exists: true } },
                ).toArray(),
                (a, b) => a.uid === b.uid,
            );
            for (const dudoc of dudocs) udict[dudoc.uid] = dudoc.rpdelta;
        },
        hidden: true,
        base: 0,
    },
};
global.Hydro.model.rp = RpTypes;

export async function calcLevel(domainId: string, report: Function) {
    const filter = { rp: { $gt: 0 } };
    const ducnt = await domain.getMultiUserInDomain(domainId, filter).count();
    await domain.setMultiUserInDomain(domainId, {}, { level: 0, rank: null });
    if (!ducnt) return;
    let last = { rp: null };
    let rank = 0;
    let count = 0;
    const coll = db.collection('domain.user');
    const ducur = domain.getMultiUserInDomain(domainId, filter).project({ rp: 1 }).sort({ rp: -1 });
    let bulk = coll.initializeUnorderedBulkOp();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const dudoc = await ducur.next();
        if (!dudoc) break;
        if ([0, 1].includes(dudoc.uid)) continue;
        count++;
        if (!dudoc.rp) dudoc.rp = null;
        if (dudoc.rp !== last.rp) rank = count;
        bulk.find({ _id: dudoc._id }).updateOne({ $set: { rank } });
        last = dudoc;
        if (count % 100 === 0) report({ message: `#${count}: Rank ${rank}` });
    }
    await bulk.execute();
    const levels = global.Hydro.model.builtin.LEVELS;
    bulk = coll.initializeUnorderedBulkOp();
    for (let i = 0; i < levels.length; i++) {
        const query: FilterQuery<Udoc> = {
            domainId,
            $and: [{ rank: { $lte: (levels[i] * count) / 100 } }],
        };
        if (i < levels.length - 1) query.$and.push({ rank: { $gt: (levels[i + 1] * count) / 100 } });
        bulk.find(query).update({ $set: { level: i } });
    }
    await bulk.execute();
}

async function runInDomain(id: string, report: Function) {
    const info = await domain.get(id);
    const domainIds = [id, ...(info.union || [])];
    const results: Record<keyof typeof RpTypes, ND> = {};
    const udict = new Proxy({}, { get: (self, key) => self[key] || 0 });
    for (const type in RpTypes) {
        results[type] = new Proxy({}, { get: (self, key) => self[key] || RpTypes[type].base });
        await RpTypes[type].run(domainIds, results[type], report);
        for (const uid in results[type]) {
            const udoc = await UserModel.getById(id, +uid);
            if (!udoc?.hasPriv(PRIV.PRIV_USER_PROFILE)) continue;
            await domain.updateUserInDomain(id, +uid, { $set: { [`rpInfo.${type}`]: results[type][uid] } });
            udict[+uid] += results[type][uid];
        }
    }
    await domain.setMultiUserInDomain(id, {}, { rp: 0 });
    const bulk = db.collection('domain.user').initializeUnorderedBulkOp();
    for (const uid in udict) {
        bulk.find({ domainId: id, uid: +uid }).upsert().update({ $set: { rp: Math.max(0, udict[uid]) } });
    }
    if (bulk.length) await bulk.execute();
    await calcLevel(id, report);
}

export async function run({ domainId }, report: Function) {
    if (!domainId) {
        const domains = await domain.getMulti().toArray();
        await report({ message: `Found ${domains.length} domains` });
        for (const i in domains) {
            const start = new Date().getTime();
            await runInDomain(domains[i]._id, report);
            await report({
                case: {
                    status: STATUS.STATUS_ACCEPTED,
                    message: `Domain ${domains[i]._id} finished`,
                    time: new Date().getTime() - start,
                    memory: 0,
                    score: 0,
                },
                progress: Math.floor(((+i + 1) / domains.length) * 100),
            });
        }
    } else await runInDomain(domainId, report);
    return true;
}

export const apply = (ctx) => ctx.addScript(
    'rp', 'Calculate rp of a domain, or all domains',
    Schema.object({ domainId: Schema.string() }), run,
);

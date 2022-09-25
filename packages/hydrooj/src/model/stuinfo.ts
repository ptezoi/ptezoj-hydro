import { pick } from 'lodash';
import LRU from 'lru-cache';
import { Student, User } from '../interface';
// import { UserNotFoundError } from '../error';
import { Logger } from '../logger';
import * as bus from '../service/bus';
import db from '../service/db';
import { Value } from '../typeutils';
// import { PERM, PRIV } from './builtin';
import { ArgMethod } from '../utils';
import TokenModel from './token';
import UserModel from './user';

const coll = db.collection('stu.info');
const domainUsercoll = db.collection('domain.user');

const logger = new Logger('model/stuinfo');
const cache = new LRU<string, any>({ max: 500, ttl: 300 * 1000 });

export function deleteStudentCache(studoc: Student | string | undefined | null, receiver = false) {
    if (!studoc) return;
    if (!receiver) {
        bus.broadcast(
            'student/delcache',
            JSON.stringify(typeof studoc === 'string' ? studoc : pick(studoc, ['stuid', '_id'])),
        );
    }
    if (typeof studoc === 'string') {
        for (const key of [...cache.keys()].filter((k) => k.endsWith(`/${studoc}`))) cache.delete(key);
        return;
    }
    const id = [`uid/${studoc._id.toString()}`, `stuid/${studoc.stuid.toLowerCase()}`];
    for (const key of [...cache.keys()].filter((k) => id.includes(`${k.split('/')[0]}/${k.split('/')[1]}`))) {
        cache.delete(key);
    }
}
bus.on('student/delcache', (content) => deleteStudentCache(JSON.parse(content), true));

class StudentModel {
    @ArgMethod
    static async getStuInfoById(_id: number): Promise<Student | null> {
        if (cache.has(`uid/${_id}`)) return cache.get(`uid/${_id}`);
        const studoc = await coll.findOne({ _id });
        if (!studoc) return null;
        cache.set(`uid/${studoc._id}`, studoc);
        return studoc;
    }

    @ArgMethod
    static async getStuInfoByStuId(stuid: string): Promise<Student | null> {
        if (cache.has(`stuid/${stuid}`)) return cache.get(`stuid/${stuid}`);
        const studoc = await coll.findOne({ stuid });
        if (!studoc) return null;
        cache.set(`stuid/${stuid}`, studoc);
        return studoc;
    }

    @ArgMethod
    static async create(uid: number, classname?: string, name?: string, stuid?: string) {
        try {
            await coll.insertOne({
                _id: uid,
                name,
                class: classname,
                stuid,
            });
            bus.broadcast('student/delCacheClassStudentsList', classname);
        } catch (e) {
            logger.warn('%o', e);
        }
    }

    @ArgMethod
    static async setById(uid: number, $set?: Partial<Student>, $unset?: Value<Partial<Student>, ''>) {
        const op: any = {};
        if ($set && Object.keys($set).length) op.$set = $set;
        if ($unset && Object.keys($unset).length) op.$unset = $unset;
        if (Object.getOwnPropertyNames(op).length === 0) return null;
        const res = await coll.findOneAndUpdate({ _id: uid }, op, { returnDocument: 'after' });
        deleteStudentCache(uid.toString());
        return res;
    }

    @ArgMethod
    static setStuID(uid: number, stuid: string) {
        return StudentModel.setById(uid, { stuid });
    }

    @ArgMethod
    static setName(uid: number, name: string) {
        return StudentModel.setById(uid, { name });
    }

    @ArgMethod
    static setClass(uid: number, cls: string) {
        return StudentModel.setById(uid, { class: cls });
    }

    static async getUserUidsByClassName(domain: string, cls: string): Promise<number[]> {
        return coll.find({ class: cls }, { sort: { stuid: 1 } }).sort({ _id: 1 }).map((stu) => stu._id).toArray();
    }

    static async getUserListByClassName(domain: string, cls: string): Promise<User[]> {
        const uids: number[] = await this.getUserUidsByClassName(domain, cls);
        const udocs: User[] = await Promise.all(uids.map((uid) => UserModel.getById(domain, uid)));
        return udocs;
    }

    static async getUserListByClassNameOrdered(domain: string, cls: string, limit: number = 3): Promise<User[]> {
        const uids: number[] = await this.getUserUidsByClassName(domain, cls);
        const promises: Promise<any>[] = await domainUsercoll.aggregate([
            { $match: { uid: { $in: uids } } },
            { $group: { _id: '$uid', rp: { $avg: '$rp' } } },
        ])
            .sort({ rp: -1 })
            .limit(limit)
            .map(async ({ _id }) => await UserModel.getById('system', _id))
            .toArray();
        const topUsers: User[] = await Promise.all(promises);
        return topUsers;
    }

    static async getClassList(domain: string = 'system'): Promise<any> {
        if (cache.has('classList')) return cache.get('classList');
        const startTime = Date.now();
        const clsCursor = await coll.aggregate([
            { $match: { class: { $not: { $in: [null, ''] } } } },
            { $group: { _id: '$class', stuNum: { $sum: 1 } } },
        ]).map((async (cls) => {
            const users: number[] = await this.getUserUidsByClassName(domain, cls._id.toString());
            const clsInfoList = await domainUsercoll.aggregate([
                { $match: { uid: { $in: users } } },
                {
                    $group: {
                        _id: 'result',
                        nAccept: { $sum: '$nAccept' },
                        nSubmit: { $sum: '$nSubmit' },
                        rpSum: { $sum: '$rp' },
                        rpAvg: { $avg: '$rp' },
                    },
                },
            ]).toArray();
            let activityList: number[];
            if (cache.has(`activity/${cls._id}`)) activityList = cache.get(`activity/${cls._id}`);
            else {
                activityList = await Promise.all(users.map(async (uid) => (
                    await TokenModel.getMostRecentSessionByUid(uid, ['createAt', 'updateAt']))?.updateAt.valueOf()
                    || (await UserModel.getById(domain, uid))?.loginat.valueOf()
                    || Date.now() - 7 * 24 * 60 * 60 * 1000));
                activityList = activityList.map((ac) => Math.max(ac, Date.now() - 7 * 24 * 60 * 60 * 1000));
                await bus.broadcast('student/cacheActivity', cls._id, JSON.stringify(activityList));
            }
            const activity = (activityList.reduce((pre, cur) => (pre + cur) / 2) % 1e10);
            if (!clsInfoList.length) {
                return {
                    ...cls, nAccept: 0, nSubmit: 0, rpSum: 1500 * cls.stuNum, rpAvg: 1500, activity,
                };
            }
            return { ...clsInfoList[0], ...cls, activity };
        })).toArray();
        const clsList: any[] = await Promise.all(clsCursor);
        clsList.forEach((cls) => { cls.rpAvg = cls.rpAvg || 1500; });
        const sortWeights = {
            rpAvg: 2,
            stuNum: 10,
            nAccept: 10,
            nSubmit: 5,
            activity: 2,
        };
        const calSortWeight = (cls) => Object.entries(sortWeights).reduce((pre, [key, val]) => pre + cls[key] * val, 0);
        const normalize = (val, min, max, newMin, newMax) => ((val - min) / (max - min)) * (newMax - newMin) + newMin;

        const activityList = clsList.map((cls: { activity: number }) => cls.activity / 1e5);
        const activityMax = Math.max(...activityList);
        const activityMin = Math.min(...activityList);
        clsList.forEach((cls) => { cls.activity = normalize(cls.activity / 1e5, activityMin - 1000, activityMax + 1000, 0, 1000); });

        clsList.forEach((cls) => { cls.weight = calSortWeight(cls); });
        const weightList = clsList.map((cls: { weight: number }) => cls.weight);
        const weightMax = Math.max(...weightList);
        const weightMin = Math.min(...weightList);
        clsList.forEach((cls) => { cls.weight = normalize(cls.weight, weightMin - 1000, weightMax + 1000, 0, 1000); });

        clsList.sort((a, b) => b.weight - a.weight);

        const res = { cacheTime: Date.now(), clsList };
        await bus.broadcast('student/cacheClassList', JSON.stringify(res));
        logger.info(`caching class list done. (${Date.now() - startTime}ms)`);
        return res;
    }
}

bus.on('student/cacheClassList', (content: string) => cache.set('classList', JSON.parse(content)));
bus.on('student/cacheActivity', (cls: string, content: string) => cache.set(`activity/${cls}`, JSON.parse(content)));
bus.on('student/invalidateClassListCache', () => cache.delete('classList'));
bus.on('student/invalidateActivityCache', () => [...cache.keys()].filter((key) => /^activity\//.test(key)).forEach((key) => cache.delete(key)));

bus.on('app/started', () => db.ensureIndexes(
    coll,
    {
        key: { stuid: 1 }, name: 'stuid', unique: true, sparse: true,
    },
    { key: { name: 1 }, name: 'name', sparse: true },
    { key: { class: 1, name: 1 }, name: '(class,name)', sparse: true },
));
global.Hydro.model.student = StudentModel;
export default StudentModel;

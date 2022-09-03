/* eslint-disable no-await-in-loop */
import { filter } from 'lodash';
import * as superagent from 'superagent';
import proxy from 'superagent-proxy';
import { STATUS } from '@hydrooj/utils/lib/status';
import { Logger } from 'hydrooj/src/logger';
import { IBasicProvider, RemoteAccount } from '../interface';

proxy(superagent as any);
const logger = new Logger('remote/loj');

export default class LOJProvider implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        if (account.cookie) this.cookie = account.cookie;
    }

    cookie: string[] = [];

    get(url: string) {
        return url;
    }

    post(url: string) {
        logger.debug('post', url, this.cookie);
        if (!url.includes('//')) url = `${this.account.endpoint || 'https://api.loj.ac.cn'}${url}`;
        const req = superagent.post(url).set('Cookie', this.cookie).type('form');
        if (this.account.proxy) return req.proxy(this.account.proxy);
        return req;
    }

    async getCsrfToken(url: string) {
        return url;
    }

    async ensureLogin() {
        return '';
    }

    async getProblem(id: string) {
        logger.info(id);
        const result = await this.post('/api/problem/getProblem')
            .send({
                displayId: id,
                localizedContentsOfAllLocales: true,
                tagsOfLocale: 'zh_CN',
                samples: true,
                judgeInfo: true,
                testData: true,
                additionalFiles: true,
            });
        if (!result.body.localizedContentsOfAllLocales) {
            return null;
        }
        let content = '';
        for (const c of result.body.localizedContentsOfAllLocales) {
            const sections = c.contentSections;
            for (const section of sections) {
                if (section.type === 'Sample') {
                    content += `\
\`\`\`input${section.sampleId}
${result.body.samples[section.sampleId].inputData}
\`\`\`
\`\`\`output${section.sampleId}
${result.body.samples[section.sampleId].outputData}
\`\`\`
`;
                } else {
                    content += `## ${section.sectionTitle}\n`;
                    content += `\n${section.text}\n\n`;
                }
            }
            let locale = c.locale;
            if (locale === 'en_US') locale = 'en';
            else if (locale === 'zh_CN') locale = 'zh';
        }
        const tags = result.body.tagsOfLocale.map((node) => node.name);
        const title = [
            ...filter(
                result.body.localizedContentsOfAllLocales,
                (node) => node.locale === 'zh_CN',
            ),
            ...result.body.localizedContentsOfAllLocales,
        ][0].title;
        const files = {};
        return {
            title,
            data: {
                'config.yaml': Buffer.from(`target: ${id}`),
            },
            files,
            tag: tags,
            content: JSON.stringify(content),
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listProblem(page: number, resync = false) {
        return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async submitProblem(id: string, lang: string, code: string, info) {
        return '';
    }

    // eslint-disable-next-line consistent-return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async waitForSubmission(id: string, next, end) {
        const status = STATUS.STATUS_SYSTEM_ERROR;
        const time = 0;
        const memory = 0;
        return await end({
            status,
            score: status === STATUS.STATUS_ACCEPTED ? 100 : 0,
            time,
            memory,
        });
    }
}

import $ from 'jquery';
import Notification from 'vj/components/notification';
import { NamedPage } from 'vj/misc/Page';
import delay from 'vj/utils/delay';
import i18n from 'vj/utils/i18n';
import request from 'vj/utils/request';

const page = new NamedPage('manage_stu_import', () => {
  async function post(draft) {
    try {
      const res = await request.post('', {
        students: $('[name="students"]').val(),
        draft,
      });
      if (!draft) {
        Notification.success(i18n('Created {0} users.', res.users.length));
        await delay(2000);
        window.location.reload();
      } else {
        $('[name="messages"]').text(res.messages.join('\n'));
      }
    } catch (error) {
      Notification.error(error.message);
    }
  }

  $('[name="preview"]').on('click', () => post(true));
  $('[name="submit"]').on('click', () => post(false));
});

export default page;

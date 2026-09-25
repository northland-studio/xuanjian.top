// 公会官方社交平台账号（唯一来源：改链接只改这里）
// 说明：
//  - QQ 群链接里的 authKey 是腾讯生成的入群校验串，不要截断；
//  - 统一用 https，避免 https 站点跳到 http 的额外提示。
import { QQIcon, BilibiliIcon, DouyinIcon } from '../components/Icons';

export const QQ_GROUP_CODE = '860336849';

export const QQ_GROUP_URL =
  'https://qm.qq.com/cgi-bin/qm/qr?_wv=1027' +
  '&k=c4YCghT0qBwEA4BxF0Ust1DuNHo6zHLo' +
  '&authKey=E8jLEy1%2BmA1Tr77Ply9XPv3Txz81oFa%2BbJugmdA0c71MADjAsbdqzRwFVJgTNDTd' +
  '&noverify=0' +
  `&group_code=${QQ_GROUP_CODE}`;

export const BILIBILI_URL = 'https://space.bilibili.com/678742876';

export const DOUYIN_URL = 'https://v.douyin.com/rIRYIfPlHeE/';

// 社交媒体页用的卡片数据
export const SOCIAL_PLATFORMS = [
  {
    name: 'QQ群',
    desc: `加入玄剑公会官方QQ群（群号 ${QQ_GROUP_CODE}），与成员实时交流`,
    Icon: QQIcon,
    color: '#12B7F5',
    link: QQ_GROUP_URL,
  },
  {
    name: 'B站',
    desc: '关注B站账号，观看公会视频与实况',
    Icon: BilibiliIcon,
    color: '#00A1D6',
    link: BILIBILI_URL,
  },
  {
    name: '抖音',
    desc: '关注抖音账号，获取公会日常花絮',
    Icon: DouyinIcon,
    color: '#FE2C55',
    link: DOUYIN_URL,
  },
];

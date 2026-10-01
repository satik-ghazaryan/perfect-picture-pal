import tatev from "@/assets/tour-tatev.jpg";
import sevan from "@/assets/tour-sevan.jpg";
import garni from "@/assets/tour-garni.jpg";

export type ItineraryStop = {
  time: string;
  title: string;
  description: string;
};

export type AudioLanguage = "hy" | "en" | "ru";

export type AudioChapter = {
  id: string;
  title: string;
  duration: number; // seconds
  audioUrl?: string;
  language?: AudioLanguage;
};

export type Hotspot = {
  id: string;
  x: number; // percent of panorama width
  y: number; // percent of viewer height
  title: string;
  description: string;
};

export type Tour = {
  id: string;
  title: string;
  image: string;
  region: string;
  type: "Արշավային" | "Մշակութային" | "Էքստրեմալ";
  departurePlace: string;
  departureTime: string;
  returnTime: string;
  price: number;
  oldPrice?: number;
  seatsLeft: number;
  rating: number;
  reviews: number;
  has360: boolean;
  hasAudioGuide: boolean;
  day: "saturday" | "sunday";
  summary: string;
  highlights: string[];
  itinerary: ItineraryStop[];
  included: string[];
  excluded: string[];
  audioChapters: AudioChapter[];
  hotspots: Hotspot[];
  panoramaUrl?: string;
};


export const regions = [
  "Գառնի և Գեղարդ",
  "Սևան և Դիլիջան",
  "Տաթև",
];

export const tourTypes = ["Արշավային", "Մշակութային", "Էքստրեմալ"] as const;

export const packingList = [
  "Հարմար քայլելու կոշիկներ",
  "Արևապաշտպան գլխարկ և արևային ակնոց",
  "Թեթև բաճկոն կամ հողմապաշտպան",
  "Անձնագիր կամ նույնականացման քարտ",
  "Լիցքավորված հեռախոս",
  "Կանխիկ կամ քարտ՝ ճաշի և հուշանվերների համար",
];

const armavirDeparture = "Արմավիր քաղաք, Կենտրոնական հրապարակ";

const baseIncluded = [
  "Հարմարավետ, օդորակիչով ավտոբուս Արմավիրից և վերադարձ",
  "Հայախոս պրոֆեսիոնալ ուղեկցորդ",
  "Աուդիոգիդ՝ հայերեն, անգլերեն և ռուսերեն",
  "Ճանապարհորդական ապահովագրություն",
  "Խմելու ջուր ողջ երթուղու ընթացքում",
];

const baseExcluded = [
  "Ճաշ և անձնական ծախսեր",
  "Հուշանվերներ",
  "Լրացուցիչ ակտիվություններ, որոնք նշված չեն ծրագրում",
  "Ուղեկցորդի և վարորդի թեյավճար",
];

export const tours: Tour[] = [
  {
    id: "garni",
    title: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա",
    image: garni,
    region: "Գառնի և Գեղարդ",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "08:30",
    returnTime: "19:30",
    price: 12000,
    seatsLeft: 3,
    rating: 4.8,
    reviews: 531,
    has360: true,
    hasAudioGuide: true,
    day: "saturday",
    summary:
      "Մեկ օրում՝ հեթանոսական Գառնիի տաճարը, ժայռափոր Գեղարդի վանքը և Ազատի կիրճի բազալտե «Քարերի սիմֆոնիան»։ Մեկնումը՝ Արմավիրի կենտրոնական հրապարակից։",
    highlights: [
      "Գառնիի տաճար՝ միակ պահպանված հելլենիստական տաճարը Հայաստանում",
      "Գեղարդի վանք՝ ՅՈՒՆԵՍԿՕ-ի ժառանգություն",
      "Քայլարշավ Ազատի կիրճի բազալտե սյուներով",
      "Լավաշի թխման ցուցադրություն գառնեցի ընտանիքի մոտ",
    ],
    itinerary: [
      {
        time: "08:30",
        title: "Մեկնում Արմավիրից",
        description: "Հավաքվում ենք Կենտրոնական հրապարակում, ուղեկցորդը բաժանում է աուդիոգիդերը։",
      },
      {
        time: "10:00",
        title: "Գառնիի տաճար",
        description: "Շրջայց տաճարում և հին բաղնիքի խճանկարներում, ազատ ժամանակ լուսանկարների համար։",
      },
      {
        time: "11:30",
        title: "Քարերի Սիմֆոնիա",
        description: "Իջնում ենք Ազատի կիրճ՝ բազալտե սյուների մոտ հեշտ քայլարշավով։",
      },
      {
        time: "13:00",
        title: "Ճաշի ընդմիջում",
        description: "Ազատ ժամանակ գյուղական ռեստորանում (ճաշը ներառված չէ)։",
      },
      {
        time: "14:30",
        title: "Գեղարդի վանք",
        description: "Ժայռափոր եկեղեցիներ, հնագույն խաչքարեր և հոգևոր երգի կատարում։",
      },
      {
        time: "17:00",
        title: "Վերադարձ",
        description: "Ճանապարհ դեպի Արմավիր՝ կարճ կանգառով հուշանվերների կրպակների մոտ։",
      },
      {
        time: "19:30",
        title: "Ժամանում Արմավիր",
        description: "Վերադարձ Կենտրոնական հրապարակ։",
      },
    ],
    included: baseIncluded,
    excluded: [...baseExcluded, "Գեղարդի հոգևոր երգի մասնավոր կատարում"],
    audioChapters: [
      { id: "g1", title: "Բարի գալուստ. ճանապարհը Արմավիրից", duration: 254 },
      { id: "g2", title: "Գառնի՝ հեթանոսական Հայաստան", duration: 412 },
      { id: "g3", title: "Ազատի կիրճ և բազալտե սյուներ", duration: 318 },
      { id: "g4", title: "Գեղարդ՝ նիզակի վանքը", duration: 486 },
      { id: "g5", title: "Ամփոփում և վերադարձ", duration: 176 },
    ],
    hotspots: [
      { id: "gh1", x: 22, y: 52, title: "Տաճարի սյունասրահ", description: "24 իոնական սյուներ՝ 1 դ. հռոմեական ոճով։" },
      { id: "gh2", x: 58, y: 64, title: "Հին բաղնիք", description: "Հունարեն մակագրությամբ խճանկարային հատակ։" },
      { id: "gh3", x: 81, y: 44, title: "Ազատի կիրճ", description: "Կիրճի տեսարան՝ բազալտե սյուներով։" },
    ],
  },
  {
    id: "sevan",
    title: "Արմավիր – Սևանա լիճ, Դիլիջան և Հաղարծին",
    image: sevan,
    region: "Սևան և Դիլիջան",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "08:00",
    returnTime: "20:00",
    price: 15000,
    seatsLeft: 8,
    rating: 4.7,
    reviews: 287,
    has360: true,
    hasAudioGuide: true,
    day: "sunday",
    summary:
      "Կապույտ Սևանը, Սևանավանքի բլուրը, Դիլիջանի անտառները և Հաղարծնի վանքը՝ մեկ օրում, Արմավիրից ուղիղ մեկնումով։",
    highlights: [
      "Սևանավանք՝ լճի վրա բացվող համայնապատկերով",
      "Դիլիջանի հին Շարամբեյան փողոց",
      "Հաղարծնի վանական համալիր անտառի մեջ",
      "Ազատ ժամանակ լճափին",
    ],
    itinerary: [
      { time: "08:00", title: "Մեկնում Արմավիրից", description: "Հավաքվում ենք Կենտրոնական հրապարակում։" },
      { time: "10:15", title: "Սևանավանք", description: "Բարձրանում ենք թերակղզու աստիճաններով, պատմություն 9-րդ դարից։" },
      { time: "11:45", title: "Լճափ", description: "Ազատ ժամանակ լուսանկարների և սուրճի համար։" },
      { time: "13:15", title: "Ճաշ Դիլիջանում", description: "Ազատ ընդմիջում քաղաքի կենտրոնում (ճաշը ներառված չէ)։" },
      { time: "14:45", title: "Շարամբեյան փողոց", description: "Վերականգնված 19-րդ դարի արհեստավորների թաղամաս։" },
      { time: "16:00", title: "Հաղարծնի վանք", description: "13-րդ դարի համալիր՝ անտառապատ լեռների մեջ։" },
      { time: "17:30", title: "Վերադարձ", description: "Ճանապարհ դեպի Արմավիր։" },
      { time: "20:00", title: "Ժամանում Արմավիր", description: "Վերադարձ Կենտրոնական հրապարակ։" },
    ],
    included: baseIncluded,
    excluded: [...baseExcluded, "Նավակով զբոսանք լճում"],
    audioChapters: [
      { id: "s1", title: "Ճանապարհ դեպի Գեղարքունիք", duration: 228 },
      { id: "s2", title: "Սևանա լիճ՝ Հայաստանի ծովը", duration: 392 },
      { id: "s3", title: "Սևանավանք", duration: 344 },
      { id: "s4", title: "Դիլիջան՝ փոքրիկ Շվեյցարիա", duration: 301 },
      { id: "s5", title: "Հաղարծին", duration: 415 },
    ],
    hotspots: [
      { id: "sh1", x: 18, y: 48, title: "Սուրբ Աստվածածին", description: "Թերակղզու երկու եկեղեցիներից հինը։" },
      { id: "sh2", x: 49, y: 70, title: "Լճափ", description: "Ավազոտ ափ՝ լողի և լուսանկարների համար։" },
      { id: "sh3", x: 76, y: 38, title: "Արեգունի լեռներ", description: "Լճի հյուսիսային եզրի լեռնաշղթան։" },
    ],
  },
  {
    id: "tatev",
    title: "Արմավիր – Տաթևի վանք և Տաթևեր ճոպանուղի",
    image: tatev,
    region: "Տաթև",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "07:00",
    returnTime: "22:00",
    price: 22000,
    seatsLeft: 5,
    rating: 4.9,
    reviews: 412,
    has360: true,
    hasAudioGuide: true,
    day: "sunday",
    summary:
      "Երկար, բայց անմոռանալի օր՝ «Տաթևեր» աշխարհի ամենաերկար ճոպանուղին, Տաթևի վանքը և Որոտանի կիրճը։ Մեկնում Արմավիրից վաղ առավոտյան։",
    highlights: [
      "«Տաթևեր»՝ 5,7 կմ ճոպանուղի Որոտանի կիրճի վրայով",
      "Տաթևի 9-րդ դարի վանական համալիր",
      "Շաքիի ջրվեժ",
      "Կանգառ Արենիում՝ գինու համտեսի հնարավորությամբ",
    ],
    itinerary: [
      { time: "07:00", title: "Մեկնում Արմավիրից", description: "Վաղ մեկնում Կենտրոնական հրապարակից։" },
      { time: "09:30", title: "Արենի", description: "Սուրճի կանգառ և գինու համտեսի հնարավորություն (առանձին վճար)։" },
      { time: "11:30", title: "Շաքիի ջրվեժ", description: "Կարճ կանգառ լուսանկարների համար։" },
      { time: "12:30", title: "Ճաշ Հալիձորում", description: "Ազատ ընդմիջում ճոպանուղու կայարանի մոտ (ճաշը ներառված չէ)։" },
      { time: "13:30", title: "«Տաթևեր» ճոպանուղի", description: "12 րոպե թռիչք կիրճի վրայով։" },
      { time: "14:00", title: "Տաթևի վանք", description: "Շրջայց վանքում, Գավազան սյուն և ձիթհան։" },
      { time: "16:30", title: "Վերադարձ", description: "Ճոպանուղով վերադարձ և ճանապարհ դեպի Արմավիր։" },
      { time: "22:00", title: "Ժամանում Արմավիր", description: "Վերադարձ Կենտրոնական հրապարակ։" },
    ],
    included: [...baseIncluded, "«Տաթևեր» ճոպանուղու երկկողմանի տոմս"],
    excluded: [...baseExcluded, "Գինու համտես Արենիում"],
    audioChapters: [
      { id: "t1", title: "Վաղ մեկնում Արմավիրից", duration: 265 },
      { id: "t2", title: "Արենի և հնագույն գինին", duration: 356 },
      { id: "t3", title: "Որոտանի կիրճ", duration: 288 },
      { id: "t4", title: "«Տաթևեր» ճոպանուղի", duration: 199 },
      { id: "t5", title: "Տաթևի համալսարանը", duration: 524 },
      { id: "t6", title: "Վերադարձի ճանապարհ", duration: 187 },
    ],
    hotspots: [
      { id: "th1", x: 26, y: 46, title: "Սբ. Պողոս-Պետրոս", description: "Վանքի գլխավոր եկեղեցին՝ 906 թ.։" },
      { id: "th2", x: 55, y: 62, title: "Գավազան սյուն", description: "Ճոճվող սյուն՝ երկրաշարժի հնագույն ցուցիչ։" },
      { id: "th3", x: 84, y: 55, title: "Որոտանի կիրճ", description: "800 մ խորությամբ կիրճ ճոպանուղու տակ։" },
    ],
  },
];

export const getTourById = (id: string) => tours.find((t) => t.id === id);


export const formatAmd = (value: number) =>
  new Intl.NumberFormat("en-US").format(value) + " ֏";

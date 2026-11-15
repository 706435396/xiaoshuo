# -*- coding: utf-8 -*-
"""
build_prompt.py — 为每本书生成"含虚拟人物"的英文出图提示词。
原则：绝不引入露骨/色情内容（生成模型会拦截），一律走艺术化、着装、氛围化表达，
既符合内容安全策略，又满足"每个封面必须有虚拟人物"的要求。
用法：python3 tools/build_prompt.py <id> <category>
"""
import sys
import hashlib

# 每个分类一套模板：moods/settings/attires 通过 id 哈希轮换，保证 1500+ 本各有差异
TEMPLATES = {
    "言情情感": {
        "style": "cinematic digital illustration",
        "gender": "woman",
        "moods": ["melancholic romantic", "tender and intimate", "longing and wistful",
                  "bittersweet affection", "gentle and dreamy"],
        "settings": ["by a rainy window", "in a misty garden at dusk", "on a quiet balcony at night",
                     "beneath falling petals", "beside a warm lamplight"],
        "attires": ["soft crimson cheongsam", "flowing ivory dress", "elegant hanfu",
                    "delicate lace blouse", "silken robe"],
    },
    "都市": {
        "style": "modern cinematic digital art",
        "gender": "woman",
        "moods": ["confident and poised", "cool and mysterious", "ambitious and sharp",
                  "world-weary yet strong", "vibrant nightlife energy"],
        "settings": ["against a neon city skyline", "in a sleek office at night",
                     "on a rain-slicked street", "at a rooftop bar", "in a bustling subway"],
        "attires": ["tailored blazer and heels", "stylish trench coat", "modern business suit",
                    "chic urban casual", "elegant evening gown"],
    },
    "校园青春": {
        "style": "bright anime-style digital art",
        "gender": "teenage girl",
        "moods": ["cheerful and sunny", "youthful and carefree", "shy and sweet",
                  "energetic and playful", "nostalgic and warm"],
        "settings": ["in a cherry-blossom courtyard", "on a school rooftop", "by a sunny classroom window",
                     "along a tree-lined path", "at a lively festival"],
        "attires": ["school uniform with ribbon", "casual summer dress", "sporty tracksuit",
                    "knit sweater and skirt", "festival yukata"],
    },
    "同人": {
        "style": "vibrant anime digital art",
        "gender": None,
        "moods": ["playful and spirited", "mischievous and bright", "dramatic and stylized",
                  "cute and energetic", "cool and confident"],
        "settings": ["in a stylized fantasy realm", "against glowing magical runes",
                     "on a vivid abstract stage", "amid swirling petals", "in a neon dreamscape"],
        "attires": ["ornate costume with ribbons", "fantasy armor with cape", "school-uniform variant",
                    "flowing magical robe", "street-style outfit"],
    },
    "游戏竞技": {
        "style": "dynamic esports digital art",
        "gender": None,
        "moods": ["focused and intense", "energetic and competitive", "cocky and confident",
                  "calm under pressure", "triumphant"],
        "settings": ["in a glowing esports arena", "at a high-tech gaming station",
                     "amid neon particle effects", "on a futuristic battlefield", "in a virtual world"],
        "attires": ["gamer headset and jacket", "team jersey and gear", "holographic armor",
                    "sleek tech suit", "casual hoodie and headset"],
    },
    "武侠": {
        "style": "ink-wash wuxia digital painting",
        "gender": None,
        "moods": ["serene and disciplined", "brooding and lone", "graceful and lethal",
                  "free-spirited", "stoic and noble"],
        "settings": ["among misty mountain peaks", "beside a bamboo forest", "on a moonlit lake",
                     "at an ancient pavilion", "in falling snow"],
        "attires": ["flowing robe with sword", "martial arts attire", "jade-green hanfu",
                    "dark assassin garb", "scholar's robe"],
    },
    "玄幻奇幻": {
        "style": "epic fantasy digital painting",
        "gender": None,
        "moods": ["majestic and powerful", "mysterious and arcane", "courageous and bright",
                  "ethereal and serene", "fierce and determined"],
        "settings": ["in a floating celestial realm", "before an ancient magic gate",
                     "atop a dragon's peak", "within a glowing forest", "amid cosmic storms"],
        "attires": ["magical robe with staff", "celestial armor", "elemental summoner garb",
                    "flowing enchanted cloak", "rune-etched battle dress"],
    },
    "历史军事": {
        "style": "historical cinematic digital art",
        "gender": None,
        "moods": ["dignified and commanding", "solemn and resolute", "valiant and proud",
                  "strategic and calm", "weathered by war"],
        "settings": ["on an ancient battlefield", "within a grand palace hall",
                     "before towering city walls", "in a torch-lit war camp", "at a riverside fort"],
        "attires": ["period armor and cloak", "imperial court robe", "general's battle dress",
                    "leather warrior gear", "historical ceremonial attire"],
    },
    "悬疑灵异": {
        "style": "atmospheric dark digital art",
        "gender": None,
        "moods": ["mysterious and haunted", "tense and watchful", "eerie and calm",
                  "secretive and cold", "otherworldly"],
        "settings": ["in swirling fog", "beneath a pale moon", "inside a shadowed corridor",
                     "among ghostly apparitions", "at a foggy crossroad"],
        "attires": ["long dark coat", "tattered spirit garb", "detective trench",
                    "pale spectral dress", "hooded cloak"],
    },
    "科幻末世": {
        "style": "futuristic sci-fi digital art",
        "gender": None,
        "moods": ["resilient and hopeful", "lonely and surviving", "determined and cold",
                  "curious and brave", "haunted by the past"],
        "settings": ["in a ruined neon city", "aboard a silent spaceship", "on a barren wasteland",
                     "within a domed colony", "amid drifting debris"],
        "attires": ["sealed survival suit", "futuristic combat armor", "engineer's tech jacket",
                    "environmental hazard gear", "sleek space uniform"],
    },
    "文学": {
        "style": "artistic minimalist digital illustration",
        "gender": None,
        "moods": ["contemplative and quiet", "wistful and literary", "serene and introspective",
                  "melancholic beauty", "timeless and calm"],
        "settings": ["by a window with books", "in a softly lit study", "beneath a lone tree",
                     "at a quiet shoreline", "within abstract light"],
        "attires": ["simple elegant dress", "scholarly cardigan", "flowing literary robe",
                    "modest period attire", "minimalist modern outfit"],
    },
    "历史": {
        "style": "historical cinematic digital art",
        "gender": None,
        "moods": ["dignified and commanding", "solemn and resolute", "valiant and proud"],
        "settings": ["on an ancient battlefield", "within a grand palace hall", "before towering city walls"],
        "attires": ["period armor and cloak", "imperial court robe", "general's battle dress"],
    },
    # 默认（大量"小说"类）：广泛轮换，保证多样性
    "小说": {
        "style": "cinematic digital illustration",
        "gender": None,
        "moods": ["melancholic romantic", "mysterious and alluring", "tender and intimate",
                  "brooding and intense", "dreamy and soft", "confident and poised",
                  "longing and wistful", "serene and elegant", "passionate and dramatic",
                  "cool and enigmatic"],
        "settings": ["by a rainy window", "in a misty garden at dusk", "against a neon skyline",
                     "beneath falling petals", "on a quiet balcony at night", "in a shadowed corridor",
                     "beside a warm lamplight", "atop a misty peak", "within soft bokeh light",
                     "along a tree-lined path"],
        "attires": ["soft crimson cheongsam", "flowing ivory dress", "elegant hanfu",
                    "modern tailored blazer", "delicate lace blouse", "silken robe",
                    "flowing magical cloak", "period-inspired gown", "casual elegant outfit",
                    "fantasy armor with cape"],
    },
}


def build_prompt(book_id, category):
    cat = category or "小说"
    tmpl = TEMPLATES.get(cat, TEMPLATES["小说"])
    h = int(hashlib.md5(str(book_id).encode("utf-8")).hexdigest(), 16)
    mood = tmpl["moods"][h % len(tmpl["moods"])]
    setting = tmpl["settings"][(h >> 4) % len(tmpl["settings"])]
    attire = tmpl["attires"][(h >> 8) % len(tmpl["attires"])]
    gender = tmpl.get("gender")
    if gender is None:
        gender = "woman" if (h & 1) else "man"
    style = tmpl["style"]
    prompt = (
        f"{style} book cover, a virtual {gender} character, {attire}, {mood} mood, "
        f"{setting}, vertical composition, highly detailed, elegant, no text, fully clothed"
    )
    return prompt


def category_of(book_id, json_path="books.json"):
    try:
        import json
        d = json.load(open(json_path, encoding="utf-8"))
        for b in d:
            if b.get("id") == book_id:
                return b.get("category") or "小说"
    except Exception:
        pass
    return "小说"


if __name__ == "__main__":
    bid = int(sys.argv[1])
    cat = sys.argv[2] if len(sys.argv) > 2 else category_of(bid)
    print(build_prompt(bid, cat))

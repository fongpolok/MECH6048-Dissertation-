import streamlit as st

from src.agent import get_medical_agent
from src.utils import load_profile

st.set_page_config(page_title="HK ElderGuard AI", layout="centered")
st.title("🩺 HK ElderGuard AI")
st.caption("香港長者三高助手 | Hypertension & Diabetes Companion")

profile = load_profile()

st.sidebar.header(f"你好，{profile['name']}！")
st.sidebar.metric("服藥情況", "✅ 今日已完成")

if "messages" not in st.session_state:
    st.session_state.messages = [{"role": "assistant", "content": "早晨！今日血壓點呀？我可以幫你解答三高問題。"}]

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

if prompt := st.chat_input("問我任何健康問題..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    st.chat_message("user").write(prompt)

    with st.chat_message("assistant"):
        with st.spinner("思考中..."):
            agent = get_medical_agent()
            result = agent.ask(prompt, profile)
            answer = result["answer"]
            st.write(answer)
            if result["sources"]:
                st.caption(f"資料來源：{'、'.join(result['sources'])}")
            else:
                st.caption("資料來源：衛生署 / 醫院管理局指引")

    st.session_state.messages.append({"role": "assistant", "content": answer})

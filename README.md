# AI-Based Smart Email Priority and Notification System

An AI-based email management system that analyzes emails, detects spam, predicts email priority, and helps users focus on important messages through intelligent notifications.

## 🚀 Features

- 📧 Email management
- 🤖 AI/ML-based email priority classification
- 🛡️ Spam email detection
- 🔔 Smart email notifications
- 📊 Email classification and analysis
- 📈 Accuracy and performance visualization
- 🔐 User login interface
- 🌐 Web-based interface
- 🧠 Machine learning model for email classification

## 🛠️ Tech Stack

### Programming Language
- Python

### Machine Learning
- Scikit-learn
- Pandas
- NumPy
- Joblib

### Web Technologies
- Flask
- HTML
- CSS
- JavaScript

### Dataset
- Enron Spam Dataset

## 📁 Project Structure

```text
MinorProject/
│
├── app.py
├── behavior.py
├── ml_model.py
├── requirements.txt
├── enron_spam_data.csv
│
├── data/
│   ├── behavior_profile.json
│   └── emails.csv
│
├── reports/
│   ├── accuracy_chart.png
│   └── priority_model.joblib
│
├── static/
│   ├── app_ui.js
│   ├── mail_ui.js
│   ├── script.js
│   ├── style.css
│   └── generated/
│       ├── accuracy_chart.png
│       ├── confusion_matrix.png
│       └── metrics_chart.png
│
└── templates/
    ├── index.html
    └── login.html

⚙️ Installation
1. Clone the Repository
git clone https://github.com/Ashx2241/AI-Based-Smart-Email-Priority-and-Notification-System.git
2. Open the Project Folder
cd AI-Based-Smart-Email-Priority-and-Notification-System
3. Create a Virtual Environment
python -m venv .venv
4. Activate the Virtual Environment

Windows:

.venv\Scripts\activate
5. Install Required Dependencies
pip install -r requirements.txt
6. Run the Application
python app.py

The application will start locally. Open the URL displayed in the terminal.

🧠 How It Works

The system processes email data and uses machine learning techniques to analyze and classify emails.

The system identifies spam emails and determines the priority of messages. The results are then displayed through a web-based interface.

The system also provides visualizations to evaluate the performance of the machine learning model.

🤖 Machine Learning

The project uses machine learning for:

Email classification
Spam detection
Email priority prediction
Model evaluation
Accuracy analysis
Confusion matrix generation

The trained model is stored using Joblib and can be used by the application for email classification.

📊 Model Evaluation

The project includes visual reports such as:

Accuracy chart
Confusion matrix
Classification metrics

These reports help evaluate the performance of the machine learning model.

🎯 Objective

The main objective of this project is to develop an intelligent email management system that automatically identifies important emails, detects spam, and helps users manage their inbox more efficiently.

🔮 Future Enhancements
Integration with Gmail and Outlook
Real-time email synchronization
Improved deep learning models
Personalized priority prediction
Mobile application
Advanced notification preferences
👨‍💻 Author

Ashwin C

B.Tech Computer Science and Engineering
SRM Institute of Science and Technology

📌 Project Type

Minor Project / Academic Project

📄 License

This project is developed for academic and educational purposes.
